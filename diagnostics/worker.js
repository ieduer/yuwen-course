import { sanitizePreviewLog } from "../site/preview-log-contract.js";

const MAX_BYTES = 4096;
export default {
  async fetch(request) {
    if (request.method !== "POST" || new URL(request.url).pathname !== "/events") return new Response(null, { status: 404 });
    const length = Number(request.headers.get("content-length"));
    if (length > MAX_BYTES) return new Response(null, { status: 413 });
    const reader = request.body?.getReader();
    if (!reader) return new Response(null, { status: 400 });
    let bytes = 0; const chunks = [];
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > MAX_BYTES) { await reader.cancel(); return new Response(null, { status: 413 }); }
        chunks.push(value);
      }
      const all = new Uint8Array(bytes); let offset = 0;
      for (const chunk of chunks) { all.set(chunk, offset); offset += chunk.byteLength; }
      const event = sanitizePreviewLog(JSON.parse(new TextDecoder().decode(all)));
      if (!event) return new Response(null, { status: 400 });
      console.log(event);
      return new Response(null, { status: 204 });
    } catch { return new Response(null, { status: 400 }); }
    finally { reader.releaseLock(); }
  },
};
