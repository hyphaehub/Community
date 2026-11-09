import { CONTAMINANT_TYPES } from '@hyphaehub/core';
import { photos } from '@hyphaehub/db';
import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { ALLOWED_IMAGE_TYPES, MAX_IMAGE_BYTES } from '../lib/images';
import { requireAuth, requireFeature } from '../middleware/auth';
import type { AppEnv } from '../types';

const r = new Hono<AppEnv>();
r.use('*', requireAuth);
r.use('*', requireFeature('aiDiagnosis'));

/** Vision model used for photo contamination diagnosis (Workers AI). */
const MODEL = '@cf/meta/llama-3.2-11b-vision-instruct';

const CONTAMINANT_ENUM = [...CONTAMINANT_TYPES, 'NONE'] as const;
type Diagnosis = {
  healthy: boolean;
  likelyContaminant: (typeof CONTAMINANT_ENUM)[number];
  confidence: 'low' | 'medium' | 'high';
  summary: string;
  recommendation: string;
};

const PROMPT = `You are an expert mycologist helping a mushroom cultivator inspect a photo of a culture (grain jar, agar plate, liquid culture, or bulk substrate/monotub). Assess ONLY what is visible in the image.

Reply with a SINGLE JSON object and nothing else, with exactly these keys:
- "healthy": boolean — true only if it looks like clean, healthy white mycelium (or normal pinning/fruit) with no sign of contamination
- "likelyContaminant": one of "TRICHODERMA","COBWEB","BACTERIAL","WET_SPOT","BLACK_MOLD","GREEN_MOLD","PINK_MOLD","YEAST","MITES","NONE","UNKNOWN" ("NONE" if it looks healthy)
- "confidence": one of "low","medium","high"
- "summary": one or two sentences describing what you see
- "recommendation": one or two sentences on what the grower should do next

Visual cues: green/blue-green powdery patches = TRICHODERMA; fast grey wispy cottony growth = COBWEB; wet slimy yellow/brown/grey with a sour look = BACTERIAL or WET_SPOT; dark/black powder = BLACK_MOLD; dusty blue-green = GREEN_MOLD; orange/pink fuzz = PINK_MOLD. Healthy mycelium is bright white and rhizomorphic or fluffy.`;

/** Pull the first {...} block out of the model text and parse it defensively. */
function parseDiagnosis(text: string): Diagnosis | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
  const contaminant = String(obj.likelyContaminant ?? 'UNKNOWN').toUpperCase();
  const confidence = String(obj.confidence ?? 'low').toLowerCase();
  return {
    healthy: obj.healthy === true,
    likelyContaminant: (CONTAMINANT_ENUM as readonly string[]).includes(contaminant)
      ? (contaminant as Diagnosis['likelyContaminant'])
      : 'UNKNOWN',
    confidence: (['low', 'medium', 'high'] as const).includes(confidence as never)
      ? (confidence as Diagnosis['confidence'])
      : 'low',
    summary: typeof obj.summary === 'string' ? obj.summary : '',
    recommendation: typeof obj.recommendation === 'string' ? obj.recommendation : '',
  };
}

/**
 * Diagnose a culture photo with AI. Accepts either a multipart `file` upload or a
 * JSON `{ photoId }` referencing a stored photo. Returns a structured diagnosis
 * the client can use to pre-fill the contamination form.
 */
r.post('/diagnose', async (c) => {
  const ai = c.env.AI;
  if (!ai) return c.json({ error: 'AI is not configured on this instance.' }, 503);

  const ws = c.var.workspace;
  let bytes: Uint8Array | null = null;

  const contentType = c.req.header('content-type') ?? '';
  if (contentType.includes('multipart/form-data')) {
    const body = await c.req.parseBody();
    const file = body.file;
    if (!(file instanceof File)) return c.json({ error: 'Expected a `file` field' }, 400);
    if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
      return c.json({ error: 'Only JPEG, PNG, WebP, GIF, AVIF, or HEIC images are allowed' }, 415);
    }
    if (file.size > MAX_IMAGE_BYTES) {
      return c.json({ error: 'Image is too large (max 15 MB)' }, 413);
    }
    bytes = new Uint8Array(await file.arrayBuffer());
  } else {
    const { photoId } = (await c.req.json().catch(() => ({}))) as { photoId?: string };
    if (!photoId) return c.json({ error: 'Provide a `file` upload or a `photoId`.' }, 400);
    const rows = await c.var.db
      .select()
      .from(photos)
      .where(and(eq(photos.id, photoId), eq(photos.workspaceId, ws.id)))
      .limit(1);
    const photo = rows[0];
    if (!photo) return c.json({ error: 'Photo not found' }, 404);
    const object = await c.var.storage.get(photo.key);
    if (!object) return c.json({ error: 'Photo file missing' }, 404);
    bytes = new Uint8Array(await new Response(object.body).arrayBuffer());
  }

  if (!bytes || bytes.byteLength === 0) return c.json({ error: 'Empty image' }, 400);

  let text: string;
  try {
    const result = (await ai.run(MODEL, {
      image: Array.from(bytes),
      prompt: PROMPT,
      max_tokens: 512,
    })) as { response?: string };
    text = result.response ?? '';
  } catch (err) {
    console.error('[ai] diagnose failed', err);
    return c.json({ error: 'The AI model could not analyze this image. Please try again.' }, 502);
  }

  const parsed = parseDiagnosis(text);
  if (!parsed) {
    // Model returned prose instead of JSON — still hand the grower the text.
    return c.json({
      healthy: false,
      likelyContaminant: 'UNKNOWN',
      confidence: 'low',
      summary: text.trim().slice(0, 600) || 'The scanner could not produce a clear reading.',
      recommendation: 'Use your own judgment, or try a clearer, well-lit photo.',
      model: MODEL,
    });
  }
  return c.json({ ...parsed, model: MODEL });
});

export default r;
