/**
 * Trigger a browser download of an in-memory blob.
 *
 * Robust across browsers:
 *  - the anchor must be attached to the DOM for Firefox to honor a programmatic
 *    click, and
 *  - the object URL must be revoked AFTER the download has started. Revoking
 *    synchronously right after `.click()` races the download and can silently
 *    save nothing — most visibly for multi-MB blobs in Chromium (e.g. a
 *    photo-heavy workspace export). Deferring the revoke to the next macrotask
 *    lets the browser capture the URL first.
 */
export function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    a.remove();
    URL.revokeObjectURL(url);
  }, 0);
}
