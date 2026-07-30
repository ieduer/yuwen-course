(() => {
  "use strict";

  function nextCursor(questions, answers) {
    return (questions || []).find((question) => answers?.[question.id]?.correct !== true)?.id || null;
  }

  function canAdvanceScheduledLesson(activeLessonId, scheduledLessonId) {
    return Boolean(activeLessonId && scheduledLessonId && activeLessonId === scheduledLessonId);
  }

  globalThis.YwVocabProgress = Object.freeze({
    nextCursor,
    canAdvanceScheduledLesson,
  });
})();
