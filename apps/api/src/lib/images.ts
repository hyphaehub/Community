/**
 * Image upload/serving safety. Photos are served from the authenticated API
 * origin, so we only ever accept and serve raster image types — never HTML or
 * SVG (which can execute script) — and cap the size.
 */
export const ALLOWED_IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/avif',
  'image/heic',
  'image/heif',
]);

/** Max accepted image size (bytes). Guards storage and Worker memory. */
export const MAX_IMAGE_BYTES = 15 * 1024 * 1024; // 15 MB

/** A content-type safe to serve inline: the stored type only if it's an allowed raster image. */
export function safeImageContentType(stored?: string | null): string {
  return stored && ALLOWED_IMAGE_TYPES.has(stored) ? stored : 'application/octet-stream';
}
