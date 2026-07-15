(() => {
  "use strict";

  const root = typeof window === "undefined" ? globalThis : window;
  const SITE_KEY = "yw";
  const MANIFEST_URL = "data/learning-manifest.json";
  let manifestPromise = null;

  function clampScore(value) {
    const score = Number(value);
    return Number.isFinite(score) ? Math.max(0, Math.min(100, Math.round(score * 10) / 10)) : 0;
  }

  function sourceUrl() {
    const location = root.location;
    if (!location) return "https://yw.bdfz.net/";
    return `${location.origin}${location.pathname}${location.hash || ""}`;
  }

  async function loadManifest() {
    manifestPromise ||= root.fetch(MANIFEST_URL, { headers: { accept: "application/json" } })
      .then((response) => {
        if (!response.ok) throw new Error(`learning manifest ${response.status}`);
        return response.json();
      });
    return manifestPromise;
  }

  function buildEvidencePayloads(manifest, item, result = {}) {
    const scorePercent = clampScore(result.scorePercent);
    const correctness = String(result.correctness || "not_applicable");
    const meta = {
      schemaVersion: 1,
      source: "yuwen-course",
      manifestVersion: manifest.manifestVersion,
      resourceKey: item.resourceKey,
      completionKind: "answer_submitted",
      correctness,
      scorePercent,
      lessonId: item.sourceId,
      questionKind: item.questionKind,
      questionId: item.questionId || null,
      questionType: item.questionType || null,
      attemptCount: Number.isFinite(Number(result.attemptCount)) ? Number(result.attemptCount) : null,
    };
    const url = sourceUrl();
    return {
      progress: {
        siteKey: SITE_KEY,
        itemKey: item.resourceKey,
        itemTitle: item.itemTitle,
        itemGroup: item.itemGroup,
        itemType: item.itemType,
        state: "completed",
        completed: true,
        progressPercent: 100,
        score: scorePercent,
        meta,
      },
      event: {
        siteKey: SITE_KEY,
        recordKey: `effect-answer:${item.resourceKey}:${Date.now()}`.slice(0, 180),
        title: `完成 · ${item.itemTitle}`,
        summary: `已提交作答 · ${scorePercent} / 100`,
        itemGroup: item.itemGroup,
        itemType: "effect-question-completion",
        contentFormat: "yw-effect-question-completion-v1",
        sourceUrl: url,
        payload: meta,
      },
    };
  }

  async function complete(resourceKey, result = {}) {
    const identity = root.BdfzIdentity;
    if (!identity?.getSession || !identity?.syncProgress) return { ok: false, reason: "identity-unavailable" };
    const session = await identity.getSession().catch(() => null);
    if (!session?.authenticated) return { ok: false, reason: "anonymous" };

    const manifest = await loadManifest();
    if (manifest?.schemaVersion !== 1 || manifest?.siteKey !== SITE_KEY) {
      return { ok: false, reason: "manifest-contract" };
    }
    const item = manifest.items?.find((candidate) => candidate.resourceKey === resourceKey);
    if (!item) return { ok: false, reason: "not-in-manifest" };

    const payloads = buildEvidencePayloads(manifest, item, result);
    await identity.syncProgress(payloads.progress);
    if (identity.recordEvent) await identity.recordEvent(payloads.event);
    return { ok: true, manifestVersion: manifest.manifestVersion, resourceKey };
  }

  root.YwLearningEvidence = Object.freeze({
    complete,
    buildEvidencePayloads,
    interactionResourceKey: (lessonId, interaction) => `effect:${lessonId}:interaction:${interaction}`,
    vocabResourceKey: (lessonId, questionId) => `effect:${lessonId}:vocab:${questionId}`,
  });
})();
