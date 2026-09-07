export class PreviewFailure extends Error {
  constructor(code, stage, status = 502) {
    super(code);
    this.name = "PreviewFailure";
    this.code = code;
    this.stage = stage;
    this.status = status;
  }
}

// One lifetime across authentication, redirects, retries and the returned body.
// Limits stay unset until upstream timing and resource-size evidence is reviewed.
// They are source-only inputs, never request parameters or environment overrides.
export function createPreviewTransfer(signal, { timeoutMs = null, maxBytes = null, observer = null } = {}) {
  for (const value of [timeoutMs, maxBytes]) {
    if (value !== null && (!Number.isSafeInteger(value) || value <= 0)) {
      throw new TypeError("invalid preview limit");
    }
  }
  const controller = new AbortController();
  let stage = "headers";
  let timer;
  let finished = false;
  let failure = null;
  const stopBodies = new Set();
  const finish = () => {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    signal?.removeEventListener("abort", clientAbort);
    observer?.finish(failure);
  };
  const abort = (error) => {
    if (finished) return;
    failure = error;
    controller.abort(error);
    for (const stop of [...stopBodies]) stop(error);
    finish();
  };
  const clientAbort = () => abort(new PreviewFailure("preview_client_cancelled", stage, 499));
  if (timeoutMs !== null) {
    timer = setTimeout(() => abort(new PreviewFailure("preview_timeout", stage, 504)), timeoutMs);
  }
  signal?.addEventListener("abort", clientAbort, { once: true });
  if (signal?.aborted) clientAbort();

  const discard = (response) => {
    // Cancellation must not create a second unbounded wait on an unused body.
    response?.body?.cancel().catch(() => {});
  };

  return {
    finish,
    discard,
    abort,
    async fetch(url, options, phase = "headers") {
      stage = phase;
      observer?.fetching(phase);
      controller.signal.throwIfAborted();
      let onAbort;
      const interrupted = new Promise((_, reject) => {
        onAbort = () => reject(controller.signal.reason);
        controller.signal.addEventListener("abort", onAbort, { once: true });
      });
      try {
        const pending = fetch(url, { ...options, signal: controller.signal }).then((response) => {
          if (controller.signal.aborted) {
            discard(response);
            throw controller.signal.reason;
          }
          return response;
        });
        const response = await Promise.race([pending, interrupted]);
        observer?.fetched(response);
        return response;
      } catch (error) {
        throw controller.signal.aborted ? controller.signal.reason
          : new PreviewFailure("preview_upstream_network", stage);
      } finally {
        controller.signal.removeEventListener("abort", onAbort);
      }
    },
    body(response, { final = true, enforceSize = true } = {}) {
      stage = "body";
      if (enforceSize) observer?.phase("body");
      controller.signal.throwIfAborted();
      if (!response.body) {
        if (final) finish();
        return null;
      }
      const length = response.headers.get("content-length");
      if (enforceSize && maxBytes !== null && /^\d+$/.test(length || "") && Number(length) > maxBytes) {
        throw new PreviewFailure("preview_body_too_large", stage);
      }
      const reader = response.body.getReader();
      let bytes = 0;
      let closed = false;
      let stop;
      const close = () => {
        closed = true;
        stopBodies.delete(stop);
        reader.releaseLock();
        if (final) finish();
      };
      return new ReadableStream({
        start(output) {
          stop = (error) => {
            if (closed) return;
            output.error(error);
            void reader.cancel(error).catch(() => {});
            close();
          };
          stopBodies.add(stop);
        },
        async pull(output) {
          try {
            const chunk = await reader.read();
            if (closed) return;
            if (chunk.done) {
              output.close();
              close();
              return;
            }
            bytes += chunk.value.byteLength;
            if (enforceSize) observer?.chunk(chunk.value.byteLength);
            if (enforceSize && maxBytes !== null && bytes > maxBytes) {
              abort(new PreviewFailure("preview_body_too_large", stage));
              return;
            }
            output.enqueue(chunk.value);
            stage = "stream";
          } catch {
            if (!closed) abort(new PreviewFailure("preview_body_failed", stage));
          }
        },
        cancel() {
          if (closed) return;
          const error = new PreviewFailure("preview_client_cancelled", stage, 499);
          // The output is already cancelled; do not call output.error here.
          stopBodies.delete(stop);
          void reader.cancel(error).catch(() => {});
          abort(error);
          close();
        },
      }, { highWaterMark: 0 });
    },
  };
}
