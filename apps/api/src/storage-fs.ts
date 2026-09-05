import { createReadStream, existsSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import type { Storage } from './storage';

/** Filesystem-backed storage for the self-hosted Node edition. */
export class FsStorage implements Storage {
  private root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  private path(key: string): string {
    // Prevent path traversal.
    const safe = key.replace(/\.\.(\/|\\|$)/g, '');
    return join(this.root, safe);
  }

  async put(key: string, body: ArrayBuffer | Uint8Array, contentType?: string): Promise<void> {
    const p = this.path(key);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, Buffer.from(body as ArrayBuffer));
    if (contentType) await writeFile(`${p}.meta`, contentType);
  }

  async get(key: string) {
    const p = this.path(key);
    if (!existsSync(p)) return null;
    const nodeStream = createReadStream(p);
    return {
      body: Readable.toWeb(nodeStream) as unknown as ReadableStream,
      contentType: undefined,
    };
  }

  async delete(key: string): Promise<void> {
    const p = this.path(key);
    await rm(p, { force: true });
    await rm(`${p}.meta`, { force: true });
  }
}
