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
    };
  }

  globalThis.YwVocabProgress = Object.freeze({
    nextCursor,
    canAdvanceScheduledLesson,
    applyServerAttempt,
  });
})();
