(() => {
  "use strict";

  const root = typeof window === "undefined" ? globalThis : window;

  function mutationId(interactionKey, lessonId) {
    const random = root.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    return `yw:${lessonId}:${interactionKey}:${random}`.slice(0, 100);
  }

  async function record(interactionKey, lessonId, data = {}, options = {}) {
    if (!interactionKey || !lessonId || !root.fetch) return { ok: false, reason: "invalid" };
    const response = await root.fetch("/api/learning/interactions", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        lessonId,
        interactionKey,
        clientMutationId: options.clientMutationId || mutationId(interactionKey, lessonId),
        classSessionId: options.classSessionId || "",
        lessonPhase: options.lessonPhase || "",
        data,
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const retryHeader = Number(response.headers?.get?.("retry-after"));
      const retryPayload = Number(payload.retryAfterSeconds);
      const retryAfterSeconds = Number.isFinite(retryPayload) && retryPayload > 0
        ? Math.ceil(retryPayload)
        : Number.isFinite(retryHeader) && retryHeader > 0
          ? Math.ceil(retryHeader)
          : null;
      return {
        ok: false,
        status: Number(response.status) || 0,
        code: String(payload.code || ""),
        retryable: payload.retryable === true || retryAfterSeconds !== null,
        retryAfterSeconds,
        reason: response.status === 401
          ? "anonymous"
          : String(payload.error || `learning interaction ${response.status}`),
      };
    }
    return payload;
  }

  root.YwLearningEvidence = Object.freeze({
    record,
    mutationId,
  });
})();
