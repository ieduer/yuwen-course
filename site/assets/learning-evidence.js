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
      if (response.status === 401) return { ok: false, reason: "anonymous" };
      throw new Error(payload.error || `learning interaction ${response.status}`);
    }
    return payload;
  }

  root.YwLearningEvidence = Object.freeze({
    record,
    mutationId,
  });
})();
