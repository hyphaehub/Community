import type { R2Bucket } from '@cloudflare/workers-types';

/** Minimal object-storage abstraction shared by R2 (cloud) and FS (self-host). */
export interface Storage {
  put(key: string, body: ArrayBuffer | Uint8Array, contentType?: string): Promise<void>;
  get(key: string): Promise<{ body: ReadableStream; contentType?: string } | null>;
  delete(key: string): Promise<void>;
}

/** Cloudflare R2-backed storage. */
export class R2Storage implements Storage {
  constructor(private bucket: R2Bucket) {}

  async put(key: string, body: ArrayBuffer | Uint8Array, contentType?: string): Promise<void> {
    await this.bucket.put(key, body, {
      httpMetadata: contentType ? { contentType } : undefined,
    });
  }

  async get(key: string) {
    const obj = await this.bucket.get(key);
    if (!obj) return null;
    return {
      body: obj.body as unknown as ReadableStream,
      contentType: obj.httpMetadata?.contentType,
    };
  }

  async delete(key: string): Promise<void> {
    await this.bucket.delete(key);
  }
}

/** No-op storage used when no bucket is configured (photos disabled). */
export class NullStorage implements Storage {
  async put(): Promise<void> {
    throw new Error('Photo storage is not configured');
  }
  async get() {
    return null;
  }
  async delete(): Promise<void> {}
}
