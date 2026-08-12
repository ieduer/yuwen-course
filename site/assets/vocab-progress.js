(() => {
  "use strict";

  function nextCursor(questions, answers) {
    return (questions || []).find((question) => answers?.[question.id]?.correct !== true)?.id || null;
  }

  function canAdvanceScheduledLesson(activeLessonId, scheduledLessonId) {
    return Boolean(activeLessonId && scheduledLessonId && activeLessonId === scheduledLessonId);
  }

  function applyServerAttempt(previous, result, selectedIndex) {
    if (!result?.ok || !["learning", "mastered"].includes(result.status)) return null;
    const wrongCount = Math.max(0, Number(result.wrongCount) || 0);
    const correctCount = Math.max(0, Number(result.correctCount) || 0);
    const mastered = result.status === "mastered";
    return {
      ...(previous || {}),
      attempts: Math.max(1, Number(result.attemptNo) || 1),
      correct: mastered,
      mastered: mastered && wrongCount === 0,
      status: result.status,
      correctCount,
      wrongCount,
      lastAnswerCorrect: result.correct === true,
      lastPick: selectedIndex,
      revealed: wrongCount >= 2,
      synced: true,
      formalEvidence: true,
    };
  }

  function applyLocalPracticeAttempt(previous, answerCorrect, selectedIndex) {
    const attempts = Math.max(0, Number(previous?.attempts) || 0) + 1;
    const correctCount = Math.max(0, Number(previous?.correctCount) || 0)
      + (answerCorrect === true ? 1 : 0);
    const wrongCount = Math.max(0, Number(previous?.wrongCount) || 0)
      + (answerCorrect === true ? 0 : 1);
    const mastered = previous?.correct === true
      || (answerCorrect === true && (attempts === 1 || correctCount >= 2));
    return {
      ...(previous || {}),
      attempts,
      correct: mastered,
      mastered: mastered && wrongCount === 0,
      status: mastered ? "mastered" : "learning",
      correctCount,
      wrongCount,
      lastAnswerCorrect: answerCorrect === true,
      lastPick: selectedIndex,
      revealed: wrongCount >= 2,
      synced: false,
      formalEvidence: false,
    };
  }

  function formalVocabularyResourceKey(lessonId, itemId) {
    return `effect:${lessonId}:vocab:${itemId}`;
  }

  function formalVocabularyResourceKeys(learningManifest) {
    if (learningManifest?.schemaVersion !== 1 || !Array.isArray(learningManifest.items)) {
      throw new Error("Unsupported learning manifest");
    }
    const keys = new Set();
    for (const item of learningManifest.items) {
      if (item?.questionKind !== "vocabulary") continue;
      const expected = formalVocabularyResourceKey(item.sourceId, item.questionId);
      if (
        item.sourceKind !== "vocabulary-question"
        || typeof item.sourceId !== "string"
        || typeof item.questionId !== "string"
        || item.resourceKey !== expected
        || keys.has(expected)
      ) {
        throw new Error("Invalid vocabulary authority entry");
      }
      keys.add(expected);
    }
    return keys;
  }

  function isFormalVocabularyQuestion(resourceKeys, lessonId, itemId) {
    return resourceKeys instanceof Set
      && resourceKeys.has(formalVocabularyResourceKey(lessonId, itemId));
  }

  function validateVocabularyAuthority(resourceKeys, activeItemIds) {
    if (!(resourceKeys instanceof Set) || !activeItemIds || typeof activeItemIds !== "object") {
      throw new Error("Invalid vocabulary authority graph");
    }
    const activeKeys = new Set();
    for (const [lessonId, itemIds] of Object.entries(activeItemIds)) {
      if (!Array.isArray(itemIds)) throw new Error("Invalid active vocabulary index");
      for (const itemId of itemIds) {
        const key = formalVocabularyResourceKey(lessonId, itemId);
        if (activeKeys.has(key)) throw new Error("Duplicate active vocabulary question");
        activeKeys.add(key);
      }
    }
    for (const key of resourceKeys) {
      if (!activeKeys.has(key)) throw new Error("Formal vocabulary question is not active");
    }
    return Object.freeze({
      active: activeKeys.size,
      formal: resourceKeys.size,
      localPractice: activeKeys.size - resourceKeys.size,
    });
  }

  globalThis.YwVocabProgress = Object.freeze({
    nextCursor,
    canAdvanceScheduledLesson,
    applyServerAttempt,
    applyLocalPracticeAttempt,
    formalVocabularyResourceKey,
    formalVocabularyResourceKeys,
    isFormalVocabularyQuestion,
    validateVocabularyAuthority,
  });
})();
