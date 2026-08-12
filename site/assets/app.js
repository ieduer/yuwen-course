const FORUM_ORIGIN = "https://forum.rdfzer.com";
const PROGRESS_KEY = "yw-matrix-progress-v2";
const LEGACY_PROGRESS_KEY = "yw-matrix-progress-v1";
const FONT_KEY = "yw-matrix-font-v1";
const LAST_LESSON_KEY = "yw-matrix-last-lesson-v1";
const MASTERY_COLLAPSED_KEY = "yw-matrix-mastery-collapsed-v1";
const FONT_STEPS = [0.92, 1, 1.12, 1.26, 1.42, 1.6];
const DEFAULT_FONT_INDEX = 3;
const STAGE_MARKS = ["甲", "乙", "丙", "丁", "戊", "己", "庚", "辛", "壬", "癸"];
const SHARED_STATE_ASSET_VERSION = "20260730-owner-v1";
const ANONYMOUS_UI_SCOPE = "anonymous-v2";
const APP_SCRIPT_URL = document.currentScript?.src || new URL("assets/app.js", document.baseURI).href;
const SHARED_STATE_MODULE_URL = new URL(
  `yw-shared-state.js?v=${SHARED_STATE_ASSET_VERSION}`,
  APP_SCRIPT_URL,
).href;
const LESSON_BLUEPRINT_RULES_URL = new URL(
  "../lesson-blueprint-rules.js?v=20260811-text-anchored-v1",
  APP_SCRIPT_URL,
).href;

let sharedStateClient = null;
let sharedStateModulePromise = null;
let sharedStateRefreshPromise = null;
let sharedStateRefreshRequested = false;
let lessonBlueprintRules = null;
let sharedStateGeneration = 0;
let sharedStateUiScope = ANONYMOUS_UI_SCOPE;
let progressOwnerScope = ANONYMOUS_UI_SCOPE;
let pendingSharedReadingPosition = null;
let pendingSharedTextScale = null;

function pendingMatchesOwner(pending, ownerScope, generation = sharedStateGeneration) {
  return Boolean(
    pending
    && pending.ownerScope === ownerScope
    && pending.generation === generation
  );
}

function bindUnownedPendingState(ownerScope, generation) {
  if (pendingSharedReadingPosition?.ownerScope === null) {
    pendingSharedReadingPosition = {
      ...pendingSharedReadingPosition,
      ownerScope,
      generation,
    };
  }
  if (pendingSharedTextScale?.ownerScope === null) {
    pendingSharedTextScale = {
      ...pendingSharedTextScale,
      ownerScope,
      generation,
    };
  }
}

function discardPendingStateForOtherOwner(ownerScope) {
  if (
    pendingSharedReadingPosition
    && pendingSharedReadingPosition.ownerScope !== null
    && pendingSharedReadingPosition.ownerScope !== ownerScope
  ) {
    pendingSharedReadingPosition = null;
  }
  if (
    pendingSharedTextScale
    && pendingSharedTextScale.ownerScope !== null
    && pendingSharedTextScale.ownerScope !== ownerScope
  ) {
    pendingSharedTextScale = null;
  }
}

function scopedUiStorageKey(baseKey, scope = sharedStateUiScope) {
  return `${baseKey}:scope:${scope}`;
}

function readScopedUiValue(baseKey, scope = sharedStateUiScope) {
  try {
    return localStorage.getItem(scopedUiStorageKey(baseKey, scope));
  } catch {
    return null;
  }
}

function writeScopedUiValue(baseKey, value, scope = sharedStateUiScope) {
  localStorage.setItem(scopedUiStorageKey(baseKey, scope), String(value));
}

function removeScopedUiValue(baseKey, scope = sharedStateUiScope) {
  localStorage.removeItem(scopedUiStorageKey(baseKey, scope));
}

const state = {
  manifest: null,
  readerIndex: null,
  taxonomy: null,
  taxonomyLessons: new Map(),
  taxonomyGenres: new Map(),
  blockId: "",
  query: "",
  lessons: new Map(),
  current: null,
  pages: [],
  pageIndex: 0,
  selectedText: "",
  lexicon: "dict",
  blueprints: new Map(),
  blueprintLoading: new Set(),
  vocabBanks: new Map(),
  vocabBankLoading: new Set(),
  vocabEligibility: null,
  vocabIndex: { activeItemIds: {} },
  formalVocabResourceKeys: new Set(),
  firstReads: new Map(),
  studyGuideLessons: new Map(),
  lessonMedia: new Map(),
  wechatArchiveBySource: new Map(),
  previewScreenshotBySource: new Map(),
  directRemoteAppRoots: new Set(),
  classicalLearningTips: new Map(),
  sharedContentVersion: "",
  progress: loadStoredProgress(),
  fontIndex: (() => {
    const stored = readScopedUiValue(FONT_KEY);
    const parsed = Number(stored);
    return stored !== null && Number.isInteger(parsed) ? parsed : DEFAULT_FONT_INDEX;
  })(),
  activeAuthorId: "",
};
const noteAnimations = new WeakMap();

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const els = {
  body: document.body,
  atlas: $("#atlas"),
  atlasOpen: $("#atlas-open"),
  atlasClose: $("#atlas-close"),
  atlasScrim: $("#atlas-scrim"),
  atlasStatus: $("#atlas-status"),
  atlasProgress: $("#atlas-progress"),
  search: $("#lesson-search"),
  bookSwitcher: $("#book-switcher"),
  lessonIndex: $("#lesson-index"),
  readingColumn: $("#reading-column"),
  topbarContext: $("#topbar-context"),
  mobileToolsToggle: $("#mobile-tools-toggle"),
  topbarActions: $("#topbar-actions"),
  title: $("#lesson-title"),
  mastheadVolume: $("#masthead-volume"),
  mastheadPosition: $("#masthead-position"),
  lessonPortraits: $("#lesson-portraits"),
  orientation: $("#orientation-content"),
  textbookTitle: $("#textbook-title"),
  textFlow: $("#text-flow"),
  materialStream: $("#material-stream"),
  materialsCount: $("#materials-count"),
  lessonMediaContent: $("#lesson-media-content"),
  lessonMediaStatus: $("#lesson-media-status"),
  lessonMediaSection: $("#lesson-media"),
  materialsSection: $("#classroom-materials"),
  authLogin: $("#auth-login"),
  checkStage: $("#check-stage"),
  matrixLinks: $("#matrix-links"),
  checkpointList: $("#checkpoint-list"),
  learningRail: $("#learning-rail"),
  masteryToggle: $("#mastery-toggle"),
  masteryPanel: $("#mastery-panel"),
  masterySpectrum: $("#mastery-spectrum"),
  masteryValue: $("#mastery-value"),
  masteryLabel: $("#mastery-label"),
  readProgress: $("#read-progress-bar"),
  lessonChatTitle: $("#lesson-chat-title"),
  lessonChatFrame: $("#lesson-chat-frame"),
  lessonChatPlaceholder: $("#lesson-chat-placeholder"),
  lessonChatLoad: $("#lesson-chat-load"),
  lessonChatSection: $("#lesson-chat"),
  pageOpen: $("#page-open"),
  resourcesOpen: $("#resources-open"),
  fontDown: $("#font-down"),
  fontUp: $("#font-up"),
  fontLabel: $("#font-label"),
  focusButton: $("#focus-button"),
  lexiconDock: $("#lexicon-dock"),
  lexiconFrame: $("#lexicon-frame"),
  lexiconScrim: $("#lexicon-scrim"),
  selectionWord: $("#selection-word"),
  lexiconClose: $("#lexicon-close"),
  moeExternal: $("#moe-external"),
  pageDialog: $("#page-dialog"),
  pageDialogTitle: $("#page-dialog-title"),
  pageImage: $("#page-image"),
  pageCaption: $("#page-caption"),
  pageStrip: $("#page-strip"),
  pagePrev: $("#page-prev"),
  pageNext: $("#page-next"),
  resourceDialog: $("#resource-dialog"),
  resourceDialogTitle: $("#resource-dialog-title"),
  resourceStage: $("#resource-dialog-stage"),
  resourceExternal: $("#resource-external"),
  toast: $("#toast"),
};

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;",
  }[char]));
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function loadStoredProgress(scope = progressOwnerScope) {
  if (!scope) return {};
  try {
    const storageKey = scopedUiStorageKey(PROGRESS_KEY, scope);
    let current = localStorage.getItem(storageKey);
    if (current === null && scope === ANONYMOUS_UI_SCOPE) {
      current = localStorage.getItem(PROGRESS_KEY) || localStorage.getItem(LEGACY_PROGRESS_KEY);
      if (current !== null) localStorage.setItem(storageKey, current);
    }
    const parsed = JSON.parse(current || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function saveStoredProgress() {
  if (!progressOwnerScope) return false;
  localStorage.setItem(
    scopedUiStorageKey(PROGRESS_KEY, progressOwnerScope),
    JSON.stringify(state.progress),
  );
  return true;
}

function refreshLocalProgressViews() {
  if (!state.manifest || !state.current) return;
  renderLessonIndex();
  renderCheckStage(state.current);
  renderMatrix(state.current);
  renderMastery();
}

function setProgressOwnerScope(scope) {
  const nextScope = scope || null;
  if (progressOwnerScope === nextScope) return;
  progressOwnerScope = nextScope;
  state.progress = loadStoredProgress(nextScope);
  refreshLocalProgressViews();
}

function enforceNewTabLinks(root = document) {
  const links = root.matches?.("a[href]") ? [root] : $$("a[href]", root);
  links.forEach((link) => {
    const href = link.getAttribute("href") || "";
    if (link.hasAttribute("data-same-tab") || href.startsWith("#")) {
      link.removeAttribute("target");
      link.removeAttribute("rel");
      return;
    }
    link.target = "_blank";
    link.rel = "noopener noreferrer";
  });
}

function userCenterLoginUrl() {
  const url = new URL("https://my.bdfz.net/");
  url.searchParams.set("returnTo", location.href);
  return url.toString();
}

function setAuthenticatedState(authenticated) {
  if (!els.authLogin) return;
  els.authLogin.href = userCenterLoginUrl();
  els.authLogin.hidden = Boolean(authenticated);
}

function loadSharedStateModule() {
  sharedStateModulePromise ||= import(SHARED_STATE_MODULE_URL).catch(() => null);
  return sharedStateModulePromise;
}

function closestFontIndex(value) {
  return FONT_STEPS.reduce((best, step, index) => (
    Math.abs(step - value) < Math.abs(FONT_STEPS[best] - value) ? index : best
  ), 0);
}

function defaultSharedLesson() {
  const defaultBlock = state.manifest?.blocks?.find(
    (block) => block.id === "xuanbi-shang" || block.title === "選必上",
  ) || state.manifest?.blocks?.[0];
  return defaultBlock?.lessons?.find(
    (lesson) => !isUnitHeading(lesson)
      && !isRetiredMirror(lesson)
      && (lesson.excerpt || "").length > 100,
  ) || state.manifest?.lessons?.[0] || null;
}

function remoteReadingPositionCompatible(position) {
  return Boolean(
    position
    && state.sharedContentVersion
    && position.contentVersion === state.sharedContentVersion
    && position.documentId === "body"
    && position.stableAnchor === "lesson-root"
    && state.manifest?.lessons?.some((lesson) => lesson.id === position.lessonId),
  );
}

function sharedContentVersionFromPointer(pointer) {
  return pointer?.schemaVersion === "yw-native-content-pointer-v1"
    && pointer?.siteKey === "yw"
    && /^yw-[0-9a-f]{24}$/.test(String(pointer?.contentVersion || ""))
    ? pointer.contentVersion
    : "";
}

async function applyRemoteSharedState(
  remoteState,
  {
    ownerScope,
    pendingKinds,
    generation,
  },
) {
  const ownerStillCurrent = () => (
    generation === sharedStateGeneration
    && sharedStateClient?.ownerScope === ownerScope
  );
  if (!ownerStillCurrent()) return;
  sharedStateUiScope = ownerScope;

  const currentPendingTextScale = pendingMatchesOwner(
    pendingSharedTextScale,
    ownerScope,
    generation,
  ) ? pendingSharedTextScale.value : null;
  const storedFontValue = readScopedUiValue(FONT_KEY, ownerScope);
  const storedFontIndex = Number(storedFontValue);
  const remoteTextScale = remoteState.readerPreferences?.TEXT_SCALE?.value;
  if (pendingKinds.has("READER_PREFERENCE:TEXT_SCALE")) {
    state.fontIndex = (
      currentPendingTextScale === null
        ? clamp(
          storedFontValue !== null && Number.isInteger(storedFontIndex)
            ? storedFontIndex
            : DEFAULT_FONT_INDEX,
          0,
          FONT_STEPS.length - 1,
        )
        : closestFontIndex(currentPendingTextScale)
    );
    if (!ownerStillCurrent()) return;
    writeScopedUiValue(FONT_KEY, state.fontIndex, ownerScope);
  } else if (Number.isFinite(remoteTextScale)) {
    state.fontIndex = closestFontIndex(remoteTextScale);
    if (!ownerStillCurrent()) return;
    writeScopedUiValue(FONT_KEY, state.fontIndex, ownerScope);
  } else {
    state.fontIndex = DEFAULT_FONT_INDEX;
    if (!ownerStillCurrent()) return;
    removeScopedUiValue(FONT_KEY, ownerScope);
  }
  applyFont();

  const storedLessonId = readScopedUiValue(LAST_LESSON_KEY, ownerScope) || "";
  const pendingLessonId = pendingKinds.has("READING_POSITION")
    ? (
      pendingMatchesOwner(
        pendingSharedReadingPosition,
        ownerScope,
        generation,
      )
        ? pendingSharedReadingPosition.lessonId
        : storedLessonId
    )
    : "";
  const remoteReadingWasDeleted = !pendingKinds.has("READING_POSITION")
    && remoteState.readingPosition === null;
  const remoteLessonId = !pendingKinds.has("READING_POSITION")
    && remoteReadingPositionCompatible(remoteState.readingPosition)
    ? remoteState.readingPosition.lessonId
    : "";
  if (remoteReadingWasDeleted) removeScopedUiValue(LAST_LESSON_KEY, ownerScope);
  const localFallbackLessonId = remoteReadingWasDeleted ? "" : storedLessonId;
  const currentLessonId = remoteReadingWasDeleted
    && state.manifest?.lessons?.some((lesson) => lesson.id === state.current?.id)
    ? state.current.id
    : "";
  const lessonId = state.manifest?.lessons?.find(
    (lesson) => lesson.id === (
      pendingLessonId || remoteLessonId || currentLessonId || localFallbackLessonId
    ),
  )?.id || defaultSharedLesson()?.id || "";
  if (!lessonId || !ownerStillCurrent()) return;
  if (state.current?.id !== lessonId) {
    await showLesson(lessonId, {
      push: true,
      recordEvidence: false,
      syncSharedState: false,
      stateGuard: ownerStillCurrent,
    });
  }
  if (!ownerStillCurrent() || state.current?.id !== lessonId) return;
  if (!remoteReadingWasDeleted) {
    writeScopedUiValue(LAST_LESSON_KEY, lessonId, ownerScope);
  }
}

function pendingSharedKinds(ownerScope, generation = sharedStateGeneration) {
  const kinds = [];
  if (pendingMatchesOwner(pendingSharedReadingPosition, ownerScope, generation)) {
    kinds.push("READING_POSITION");
  }
  if (pendingMatchesOwner(pendingSharedTextScale, ownerScope, generation)) {
    kinds.push("READER_PREFERENCE:TEXT_SCALE");
  }
  return kinds;
}

async function persistPendingSharedState(client, ownerScope) {
  const generation = sharedStateGeneration;
  const ownerStillCurrent = async () => (
    client === sharedStateClient
    && client.ownerScope === ownerScope
    && generation === sharedStateGeneration
  );
  if (
    !client
    || !await ownerStillCurrent()
  ) return;

  if (pendingMatchesOwner(pendingSharedReadingPosition, ownerScope, generation)) {
    const pending = pendingSharedReadingPosition;
    try {
      if (state.current?.id !== pending.lessonId) {
        await showLesson(pending.lessonId, {
          push: true,
          recordEvidence: false,
          syncSharedState: false,
          stateGuard: ownerStillCurrent,
        });
      }
      if (!await ownerStillCurrent() || state.current?.id !== pending.lessonId) return;
      writeScopedUiValue(LAST_LESSON_KEY, pending.lessonId, ownerScope);
      if (
        pending.contentVersion
        && pending.contentVersion === state.sharedContentVersion
      ) {
        client.queueReadingPosition(pending);
      }
      if (pendingSharedReadingPosition === pending) {
        pendingSharedReadingPosition = null;
      }
    } catch {
      return;
    }
  }

  if (pendingMatchesOwner(pendingSharedTextScale, ownerScope, generation)) {
    const pending = pendingSharedTextScale;
    try {
      if (!await ownerStillCurrent()) return;
      state.fontIndex = closestFontIndex(pending.value);
      writeScopedUiValue(FONT_KEY, state.fontIndex, ownerScope);
      applyFont();
      client.queueTextScale(pending.value);
      if (pendingSharedTextScale === pending) pendingSharedTextScale = null;
    } catch {
      return;
    }
  }
  await client.flush();
}

async function applyAnonymousSharedState() {
  sharedStateGeneration += 1;
  sharedStateClient = null;
  sharedStateUiScope = ANONYMOUS_UI_SCOPE;
  if (pendingSharedReadingPosition?.ownerScope === null) {
    writeScopedUiValue(
      LAST_LESSON_KEY,
      pendingSharedReadingPosition.lessonId,
      ANONYMOUS_UI_SCOPE,
    );
    pendingSharedReadingPosition = null;
  } else {
    pendingSharedReadingPosition = null;
    const requestedLessonId = location.hash.slice(1);
    const hashLessonId = studentVisibleLessons().find(
      (lesson) => lesson.id === requestedLessonId,
    )?.id || "";
    const storedLessonId = readScopedUiValue(
      LAST_LESSON_KEY,
      ANONYMOUS_UI_SCOPE,
    ) || "";
    const storedStudentLessonId = studentVisibleLessons().find(
      (lesson) => lesson.id === storedLessonId,
    )?.id || "";
    const lessonId = hashLessonId || storedStudentLessonId || defaultSharedLesson()?.id || "";
    if (lessonId && state.current?.id !== lessonId) {
      await showLesson(lessonId, {
        push: true,
        recordEvidence: false,
        syncSharedState: false,
      });
    }
  }
  if (pendingSharedTextScale?.ownerScope === null) {
    writeScopedUiValue(
      FONT_KEY,
      closestFontIndex(pendingSharedTextScale.value),
      ANONYMOUS_UI_SCOPE,
    );
    pendingSharedTextScale = null;
  } else {
    pendingSharedTextScale = null;
    const storedFontValue = readScopedUiValue(FONT_KEY, ANONYMOUS_UI_SCOPE);
    const storedFontIndex = Number(storedFontValue);
    state.fontIndex = clamp(
      storedFontValue !== null && Number.isInteger(storedFontIndex)
        ? storedFontIndex
        : DEFAULT_FONT_INDEX,
      0,
      FONT_STEPS.length - 1,
    );
    applyFont();
  }
}

async function hydrateSharedStateOnce() {
  const deadline = Date.now() + 6000;
  while (!window.BdfzIdentity && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  const identity = window.BdfzIdentity;
  if (!identity?.api) return;
  const session = await identity.getSession?.().catch(() => null);
  if (!session || typeof session.authenticated !== "boolean") {
    setAuthenticatedState(false);
    setProgressOwnerScope(null);
    return;
  }
  if (!session.authenticated) {
    setAuthenticatedState(false);
    setProgressOwnerScope(ANONYMOUS_UI_SCOPE);
    await applyAnonymousSharedState();
    return;
  }

  setAuthenticatedState(true);
  setProgressOwnerScope(null);
  const sharedState = await loadSharedStateModule();
  if (!sharedState) return;
  const discoveryPayload = await identity.api("/api/yw/v1/state").catch(() => null);
  const discovery = sharedState.normalizeSharedStateResponse(discoveryPayload);
  if (!discovery?.ownerScope) return;
  setProgressOwnerScope(discovery.ownerScope);

  if (sharedStateClient?.ownerScope !== discovery.ownerScope) {
    discardPendingStateForOtherOwner(discovery.ownerScope);
    sharedStateGeneration += 1;
    const generation = sharedStateGeneration;
    bindUnownedPendingState(discovery.ownerScope, generation);
    sharedStateClient = sharedState.createSharedStateClient({
      api: (path, options) => identity.api(path, options),
      storage: localStorage,
      storageKey: `yw-shared-state-outbox/2:${discovery.ownerScope}`,
      ownerScope: discovery.ownerScope,
      onRemoteState: (remoteState, context) => applyRemoteSharedState(
        remoteState,
        { ...context, generation },
      ),
    });
  } else {
    bindUnownedPendingState(discovery.ownerScope, sharedStateGeneration);
  }
  const client = sharedStateClient;
  const ownerScope = discovery.ownerScope;
  const hydrated = await client.hydrate({
    pendingKinds: pendingSharedKinds(ownerScope),
    initialState: discoveryPayload,
  });
  if (!hydrated.ok || client !== sharedStateClient) return;
  await persistPendingSharedState(client, ownerScope);
}

function flushSharedState() {
  sharedStateRefreshRequested = true;
  if (sharedStateRefreshPromise) return sharedStateRefreshPromise;
  sharedStateRefreshPromise = (async () => {
    while (sharedStateRefreshRequested) {
      sharedStateRefreshRequested = false;
      try {
        await hydrateSharedStateOnce();
      } catch {
        // The local textbook remains available while shared state is unavailable.
      }
    }
  })().finally(() => {
    sharedStateRefreshPromise = null;
  });
  return sharedStateRefreshPromise;
}

function queueSharedReadingPosition(lesson) {
  if (!lesson?.id) return;
  pendingSharedReadingPosition = {
    contentVersion: state.sharedContentVersion,
    lessonId: lesson.id,
    documentId: "body",
    stableAnchor: "lesson-root",
    ownerScope: sharedStateClient?.ownerScope || null,
    generation: sharedStateGeneration,
  };
  void flushSharedState();
}

function queueSharedTextScale() {
  pendingSharedTextScale = {
    value: FONT_STEPS[state.fontIndex],
    ownerScope: sharedStateClient?.ownerScope || null,
    generation: sharedStateGeneration,
  };
  void flushSharedState();
}

function lessonProgress(id = state.current?.id) {
  if (!id) return {};
  state.progress[id] ||= {};
  return state.progress[id];
}

const MODE_TRACKS = {
  classical: [
    ["firstRead", "無注疏初讀", "", 25],
    ["vocabulary", "詞級疏通", "", 30],
    ["structure", "考辨與章法", "", 20],
    ["evaluation", "本篇有意思", "", 10],
    ["authorQuestion", "遷移與追問", "", 15],
  ],
  poetry: [
    ["context", "初讀評議", "", 10], ["vocabulary", "詞級疏通", "", 25],
    ["read", "通讀正文", "", 10],
    ["revision", "字句之改", "", 15],
    ["structure", "詩脈轉折", "", 20], ["evaluation", "篇目評價", "", 10], ["authorQuestion", "叩問作者", "", 10],
  ],
  fiction: [
    ["context", "初讀評議", "", 10], ["vocabulary", "詞級疏通", "", 25],
    ["read", "通讀正文", "", 10],
    ["revision", "字句之改", "", 15],
    ["structure", "敘事機關", "", 20], ["evaluation", "篇目評價", "", 10], ["authorQuestion", "叩問作者", "", 10],
  ],
  drama: [
    ["context", "初讀評議", "", 10], ["vocabulary", "詞級疏通", "", 25],
    ["read", "通讀正文", "", 10],
    ["revision", "字句之改", "", 15],
    ["structure", "場面調度", "", 20], ["evaluation", "篇目評價", "", 10], ["authorQuestion", "叩問作者", "", 10],
  ],
  journalism: [
    ["context", "初讀評議", "", 10], ["vocabulary", "詞級疏通", "", 25],
    ["read", "通讀正文", "", 10],
    ["revision", "字句之改", "", 15],
    ["structure", "材料編排", "", 20], ["evaluation", "報道評價", "", 10], ["authorQuestion", "叩問作者", "", 10],
  ],
  argument: [
    ["context", "初讀評議", "", 10], ["vocabulary", "詞級疏通", "", 25],
    ["read", "通讀正文", "", 10],
    ["revision", "字句之改", "", 15],
    ["structure", "論證骨架", "", 20], ["evaluation", "觀點評價", "", 10], ["authorQuestion", "叩問作者", "", 10],
  ],
  science: [
    ["context", "初讀評議", "", 10], ["vocabulary", "詞級疏通", "", 25],
    ["read", "通讀正文", "", 10],
    ["revision", "字句之改", "", 15],
    ["structure", "說明次序", "", 20], ["evaluation", "文本評價", "", 10], ["authorQuestion", "叩問作者", "", 10],
  ],
  "unit-intro": [
    ["context", "單元定位", "", 20], ["read", "讀清說明", "", 20],
    ["structure", "繪製路徑", "", 25], ["evaluation", "單元預判", "", 15],
    ["authorQuestion", "提出總問題", "", 20],
  ],
  "unit-task": [
    ["context", "單元定位", "", 15], ["read", "拆解要求", "", 15],
    ["revision", "改造任務", "", 15], ["structure", "成果路徑", "", 25],
    ["evaluation", "任務評價", "", 10], ["authorQuestion", "提出問題", "", 20],
  ],
};

function modeFor(lesson = state.current) {
  const mode = state.taxonomyLessons.get(lesson?.id)?.mode || genreFor(lesson);
  if (["whole-book", "language-activity", "review"].includes(mode)) return "unit-task";
  if (mode === "speech-letter" || mode === "modern-prose") return "argument";
  return MODE_TRACKS[mode] ? mode : "argument";
}

function sourceModeFor(lesson = state.current) {
  return state.taxonomyLessons.get(lesson?.id)?.mode || genreFor(lesson);
}

function lessonHasVocabulary(lesson = state.current) {
  const lessonId = lesson?.id || "";
  if (!lessonId) return false;
  const activeIds = state.vocabIndex?.activeItemIds?.[lessonId] || [];
  if (!activeIds.length) return false;
  const mode = sourceModeFor(lesson);
  const policy = state.vocabEligibility;
  if (!policy) return mode === "classical" || mode === "poetry";
  if ((policy.defaultEligibleModes || []).includes(mode)) return true;
  return (policy.exceptions || []).some((exception) => (
    exception.lessonId === lessonId && activeIds.includes(exception.itemId)
  ));
}

function normalizeTrackWeights(track) {
  const total = track.reduce((sum, item) => sum + Number(item[3] || 0), 0);
  if (total === 100 || total <= 0) return track;
  let assigned = 0;
  return track.map((item, index) => {
    const weight = index === track.length - 1
      ? 100 - assigned
      : Math.round(Number(item[3] || 0) / total * 100);
    assigned += weight;
    return [item[0], item[1], item[2], weight];
  });
}

function trackFor(lesson = state.current) {
  const track = MODE_TRACKS[modeFor(lesson)];
  return normalizeTrackWeights(
    lessonHasVocabulary(lesson)
      ? track
      : track.filter(([key]) => key !== "vocabulary"),
  );
}

function checkpointDone(progress, key, lesson = state.current) {
  if (!progressOwnerScope || progressOwnerScope === ANONYMOUS_UI_SCOPE) return false;
  if (key === "firstRead") {
    const session = state.firstReads.get(lesson?.id);
    return Boolean(session?.authMode === "authenticated" && session?.submitted);
  }
  if (key === "read" || key === "context") return progress[key] === true || Boolean(progress[key]?.done);
  if (key === "vocabulary") {
    const vocabularyDone = Boolean(
      progress.vocabulary?.done
      && (sourceModeFor(lesson) !== "poetry" || progress.wordCreation?.done),
    );
    if (!vocabularyDone || sourceModeFor(lesson) !== "classical") return vocabularyDone;
    if (!studyGuideCompletedFor(lesson, ["vocabulary", "syntax"])) return false;
    const session = state.firstReads.get(lesson?.id);
    return Boolean(session?.submitted && session.marks.length > 0
      && session.marks.every((mark) => mark.resolutionStatus === "resolved"));
  }
  if (key === "structure" && sourceModeFor(lesson) === "classical") {
    return Boolean(progress.structure?.done && studyGuideCompletedFor(lesson, ["comprehension"]));
  }
  return Boolean(progress[key]?.done);
}

function studyGuideProgress(progress = lessonProgress()) {
  progress.studyGuide ||= { items: {} };
  progress.studyGuide.items ||= {};
  return progress.studyGuide.items;
}

function studyGuideItemsFor(lesson, competencyTags) {
  const lessonData = state.studyGuideLessons.get(lesson?.id);
  const tags = new Set(competencyTags);
  return (lessonData?.items || []).filter((item) => tags.has(item.competencyTag));
}

function studyGuideRecordMatches(item, record) {
  return Boolean(
    item
    && record?.completed === true
    && record.semanticRevision === item.semanticRevision,
  );
}

function studyGuideCompletedFor(lesson, competencyTags) {
  const active = studyGuideItemsFor(lesson, competencyTags).filter((item) => item.activeForSelfTest);
  if (!active.length) return true;
  const records = studyGuideProgress(lessonProgress(lesson?.id));
  return active.every((item) => studyGuideRecordMatches(item, records[item.itemKey]));
}

function progressPercent(progress = lessonProgress(), lesson = state.current) {
  return trackFor(lesson).reduce((sum, [key, _label, _detail, weight]) => sum + (checkpointDone(progress, key, lesson) ? weight : 0), 0);
}

function toast(message) {
  els.toast.textContent = message;
  els.toast.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => els.toast.classList.remove("show"), 2400);
}

async function fetchJson(url, { cache = "default" } = {}) {
  const response = await fetch(url, {
    headers: { accept: "application/json" },
    cache,
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.json();
}

function hexDigest(buffer) {
  return [...new Uint8Array(buffer)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function fetchVerifiedJson(url, receipt) {
  const response = await fetch(url, {
    headers: { accept: "application/json" },
    cache: "no-cache",
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!Number.isInteger(receipt?.bytes) || bytes.byteLength !== receipt.bytes) {
    throw new Error("reader document byte receipt mismatch");
  }
  if (!globalThis.crypto?.subtle || !/^[a-f0-9]{64}$/i.test(receipt?.sha256 || "")) {
    throw new Error("reader document hash receipt unavailable");
  }
  const digest = hexDigest(await globalThis.crypto.subtle.digest("SHA-256", bytes));
  if (digest !== receipt.sha256) throw new Error("reader document hash receipt mismatch");
  return JSON.parse(new TextDecoder().decode(bytes));
}

function validateReaderIndex(index) {
  if (index?.schemaVersion !== "yw-reader-document-index-v1") {
    throw new Error("reader index schema mismatch");
  }
  const lessonIds = state.manifest.lessons.map((lesson) => lesson.id);
  const receiptIds = Object.keys(index.documents || {});
  if (
    index.lessonCount !== lessonIds.length
    || JSON.stringify(receiptIds.sort()) !== JSON.stringify([...lessonIds].sort())
  ) {
    throw new Error("reader index inventory mismatch");
  }
  return index;
}

async function loadReaderIndex() {
  if (state.readerIndex) return state.readerIndex;
  const index = validateReaderIndex(await fetchJson(
    "data/reader-documents/index.json",
    { cache: "no-cache" },
  ));
  state.readerIndex = index;
  return index;
}

async function loadReaderDocument(id) {
  const index = await loadReaderIndex();
  const receipt = index.documents[id];
  const expectedPath = `reader-documents/${id}.json`;
  if (!receipt || receipt.path !== expectedPath) {
    throw new Error("reader document receipt missing");
  }
  const document = await fetchVerifiedJson(`data/${receipt.path}`, receipt);
  if (
    document?.schemaVersion !== "yw-reader-document-v1"
    || document.lessonId !== id
    || document.curationVersion !== index.curationVersion
    || document.roleAuditSha256 !== index.roleAuditSha256
    || document.main?.sourcePostId !== receipt.primaryPostId
  ) {
    throw new Error("reader document identity mismatch");
  }
  return document;
}

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[，。！？、；：“”‘’（）《》\s·—…]/g, "")
    .replace(/課/g, "课")
    .replace(/學/g, "学")
    .replace(/習/g, "习")
    .replace(/選/g, "选")
    .replace(/單/g, "单");
}

function lessonTitle(lesson) {
  const raw = [lesson?.title, lesson?.sourceTitle, lesson?.tocLabel, lesson?.textbook?.tocLabel].filter(Boolean).join(" ");
  if (/单元(研习|学习)任务|單元(研習|學習)任務/.test(raw)) {
    return lesson.tocLabel || lesson.textbook?.tocLabel || lesson.title || "單元研習任務";
  }
  return String(lesson.title || lesson.tocLabel || lesson.textbook?.tocLabel || "未命名課文")
    .replace(/^\s*\d+\s*[.．、]?\s*/, "")
    .replace(/\s*\/\s*[\p{L}·、，,\s]{2,30}$/u, "")
    .trim();
}

function isUnitTask(lesson) {
  return /单元(研习|学习)任务|單元(研習|學習)任務/.test([
    lesson?.title, lesson?.sourceTitle, lesson?.tocLabel, lesson?.textbook?.tocLabel,
  ].filter(Boolean).join(" "));
}

function isUnitHeading(lesson) {
  return !isUnitTask(lesson) && /第[一二三四五六七八九十0-9]+[单單]元/.test(lessonTitle(lesson));
}

function isRetiredMirror(lesson) {
  return /Google\s*site|Google\s*Sites|課堂進度記錄|课堂进度记录|語雀|语雀/i.test(lessonTitle(lesson));
}

function genreFor(lesson) {
  const taxonomyMode = state.taxonomyLessons.get(lesson?.id)?.mode;
  if (taxonomyMode) return taxonomyMode;
  const title = lessonTitle(lesson);
  const excerpt = lesson.excerpt || "";
  if (isUnitHeading(lesson) || isUnitTask(lesson)) return "unit";
  if (/诗|詩|词|詞|歌|赋|賦|离骚|離騷|蜀道难|蜀道難|短歌行|琵琶行|兰亭|蘭亭|赤壁|登高|锦瑟|錦瑟|氓/.test(title)) return "poetry";
  if (/记|記|传|傳|表|序|论|論|说|說|书|書|孟子|庄子|莊子|论语|論語|史记|史記/.test(title)
    || (excerpt.match(/[之其者也矣焉兮曰]/g) || []).length > 16) return "classical";
  if (/新闻|消息|通讯|演讲|讲话|报告|宣言|社会|实践|改造/.test(title)) return "argument";
  return "narrative";
}

const genreCopy = {
  unit: {
    label: "單元統整",
    lenses: ["核心任務", "篇目關係", "能力遷移"],
    question: "用一條清晰的學習路徑說明：這個單元要求你從哪些文本證據走向哪一種語文能力？",
  },
  poetry: {
    label: "詩歌細讀",
    lenses: ["意象與鍊字", "節奏與轉折", "情感與詩史"],
    question: "選用你收集的原句，說明一個字詞或意象如何推動情感、結構與全詩立意。",
  },
  classical: {
    label: "古文細讀",
    lenses: ["實虛詞與句法", "行文與章法", "知人論世"],
    question: "以原文為證據，說明一處字句安排如何同時服務人物、結構或作者立意。",
  },
  argument: {
    label: "論述細讀",
    lenses: ["概念與判斷", "論證與推進", "時代與立場"],
    question: "指出文中的核心判斷，並用一處原文說明作者如何把材料推進為觀點。",
  },
  narrative: {
    label: "敘事細讀",
    lenses: ["字句與語氣", "敘事與結構", "人物與立意"],
    question: "選用你收集的原句，說明敘述視角、反覆、對比或細節如何導向作品立意。",
  },
};

function taxonomyFor(lesson = state.current) {
  return state.taxonomyLessons.get(lesson?.id) || { genres: [], authors: [], sourceBooks: [], mode: genreFor(lesson) };
}

function activeAuthorFor(lesson = state.current) {
  const authors = taxonomyFor(lesson).authors || [];
  return authors.find((author) => author.id === state.activeAuthorId) || authors[0] || null;
}

function authorNameFor(lesson = state.current) {
  return activeAuthorFor(lesson)?.name || (modeFor(lesson).startsWith("unit") ? "編者" : "作者");
}

function blueprintKey(lesson = state.current) {
  return `${lesson?.id || "lesson"}:${activeAuthorFor(lesson)?.id || "editor"}`;
}

function genreNodesFor(lesson = state.current) {
  return taxonomyFor(lesson).genres.map((id) => state.taxonomyGenres.get(id)).filter(Boolean);
}

function primaryGenreLabel(lesson = state.current) {
  return genreNodesFor(lesson)[0]?.label || genreCopy[genreFor(lesson)]?.label || "語文學習";
}

function currentMeta() {
  return state.manifest?.lessons?.find((lesson) => lesson.id === state.current?.id) || state.current || {};
}

function openAtlas() {
  els.body.classList.add("atlas-open");
  els.atlas.setAttribute("aria-hidden", "false");
  els.atlasOpen.setAttribute("aria-expanded", "true");
}

function closeAtlas() {
  els.body.classList.remove("atlas-open");
  els.atlas.setAttribute("aria-hidden", "true");
  els.atlasOpen.setAttribute("aria-expanded", "false");
}

function renderBooks() {
  els.bookSwitcher.innerHTML = state.manifest.blocks.map((block) => `
    <button type="button" data-block="${esc(block.id)}" class="${block.id === state.blockId ? "active" : ""}">
      ${esc(block.title)}
    </button>
  `).join("");
}

function studentVisibleLessons() {
  return (state.manifest?.lessons || []).filter((lesson) => !isRetiredMirror(lesson));
}

function visibleLessons() {
  const block = state.manifest.blocks.find((item) => item.id === state.blockId) || state.manifest.blocks[0];
  const query = normalizeText(state.query);
  return (block?.lessons || []).filter((lesson) => {
    if (isRetiredMirror(lesson)) return false;
    if (!query) return true;
    return normalizeText([lesson.title, lesson.sourceTitle, lesson.tocLabel, lesson.excerpt].join(" ")).includes(query);
  });
}

function renderLessonIndex() {
  const lessons = visibleLessons();
  let sequence = 0;
  els.lessonIndex.innerHTML = lessons.map((lesson) => {
    const heading = isUnitHeading(lesson);
    if (!heading) sequence += 1;
    const done = progressPercent(state.progress[lesson.id] || {}, lesson) === 100;
    const page = lesson.textbookStartPage || lesson.textbook?.startPage;
    return `
      ${heading ? `<div class="unit-marker">${esc(lessonTitle(lesson))}</div>` : ""}
      <button type="button" class="lesson-link ${state.current?.id === lesson.id ? "active" : ""} ${heading ? "overview" : ""}" data-lesson="${esc(lesson.id)}">
        <span>${heading ? "導" : String(sequence).padStart(2, "0")}</span>
        <strong>${esc(lessonTitle(lesson))}</strong>
        <small>${done ? "步驟完成" : page ? `p${page}` : isUnitTask(lesson) ? "任務" : ""}</small>
      </button>
    `;
  }).join("") || `<p class="index-empty">沒有匹配的課文。</p>`;
  const allIds = studentVisibleLessons().map((lesson) => lesson.id);
  const mastered = allIds.filter((id) => progressPercent(state.progress[id] || {}, { id }) === 100).length;
  els.atlasProgress.textContent = `${mastered} / ${allIds.length}`;
}

function removeUnwantedSourceNodes(root) {
  $$('script, style, iframe, form', root).forEach((node) => node.remove());
  $$('small', root).forEach((node) => {
    if (/companion discussion|sites\.google|yuque|語雀/i.test(node.textContent || "")) node.remove();
  });
  $$('.footnote-ref, .footnotes-list, .footnotes-sep', root).forEach((node) => node.remove());
  $$('a', root).forEach((link) => {
    const raw = link.getAttribute("href") || "";
    if (raw.startsWith("#")) return;
    let url;
    try { url = new URL(raw, FORUM_ORIGIN); } catch { return; }
    if (/sites\.google\.com|yuque\.com/i.test(url.hostname)) {
      link.replaceWith(document.createTextNode(link.textContent || ""));
      return;
    }
    if (url.origin === FORUM_ORIGIN || raw.startsWith("/")) link.href = url.toString();
    if (!url.hash || url.origin !== location.origin) {
      link.target = "_blank";
      link.rel = "noreferrer";
    }
  });
  $$('img', root).forEach((image) => {
    try { image.src = new URL(image.getAttribute("src") || "", FORUM_ORIGIN).toString(); } catch { /* noop */ }
    image.loading = "lazy";
    image.decoding = "async";
  });
  root.innerHTML = root.innerHTML
    .replace(/\[\/?color(?:=[^\]]+)?\]/gi, "")
    .replace(/\[\d+:\d+\]/g, "")
    .replace(/\[right\]|\[center\]|\[left\]|\[\/right\]|\[\/center\]|\[\/left\]/gi, "");
}

function cleanAnnotationText(value) {
  return String(value || "")
    .replace(/\[color=[^\]]+\]|\[\/color\]/gi, "")
    .replace(/(?:<|&lt;)\/?span(?:\s[^>]*?)?(?:>|&gt;)/gi, "")
    .replace(/↩︎/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function annotationParts(value) {
  const text = cleanAnnotationText(value);
  const bracketed = text.match(/^〔([^〕]+)〕\s*(.*)$/s);
  const colon = !bracketed ? text.match(/^(.{1,28}?)[：:]\s*(.*)$/s) : null;
  const rawWord = bracketed?.[1] || colon?.[1] || text.slice(0, 12);
  const word = rawWord
    .replace(/[（(][^）)]*[）)]/g, "")
    .replace(/[A-Za-zāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜüɡ]+/g, "")
    .replace(/[「」『』“”‘’《》〈〉（）()〔〕［］【】\[\]，。；;、？！!?：:\s]/g, "")
    .trim();
  return { word, note: (bracketed?.[2] || colon?.[2] || text).trim() };
}

function precedingAnnotationWord(reference) {
  const text = reference?.previousSibling?.textContent || "";
  return text.match(/([\p{Script=Han}·]{1,8})$/u)?.[1] || "";
}

function cleanedCooked(html) {
  const doc = new DOMParser().parseFromString(`<div id="clean-root">${html || ""}</div>`, "text/html");
  const root = doc.querySelector("#clean-root");
  removeUnwantedSourceNodes(root);
  return root.innerHTML;
}

function primaryContentParts(lesson) {
  const primary = primaryPost(lesson);
  if (!primary) return { html: "", examPrompts: [], frontMatter: "" };
  const doc = new DOMParser().parseFromString(`<div id="primary-root">${cleanedCooked(primary.cooked)}</div>`, "text/html");
  const root = doc.querySelector("#primary-root");
  const firstQuote = root.querySelector("blockquote");
  const examPrompts = firstQuote && /(20\d{2}|高考|真题|真題)/.test(firstQuote.textContent || "")
    ? $$('p', firstQuote).map((node) => (node.textContent || "").replace(/\s+/g, " ").trim()).filter(Boolean)
    : [];
  let frontMatter = "";
  if (examPrompts.length) {
    firstQuote.remove();
  } else if (firstQuote && /(选自|選自|作者|写了|寫了|人\（|人\(|生卒|原题|原題)/.test(firstQuote.textContent || "")) {
    frontMatter = firstQuote.innerHTML;
    firstQuote.remove();
  }
  const firstHeading = root.querySelector("h1, h2, h3");
  if (firstHeading) {
    const heading = normalizeText(firstHeading.textContent || "");
    const title = normalizeText(lessonTitle(lesson)).replace(/^\d+/, "");
    if (heading.length > 1 && (title.includes(heading) || heading.includes(title.slice(0, Math.min(12, title.length))))) firstHeading.remove();
  }
  return { html: root.innerHTML, examPrompts, frontMatter };
}

function meaningfulPosts(lesson) {
  const seen = new Set();
  return (lesson.posts || []).filter((post) => {
    const text = String(post.plain_text || "").replace(/\s+/g, " ").trim();
    const key = normalizeText(text).slice(0, 1000);
    if (key.length < 20 && !(post.images || []).length) return false;
    if (key.length > 80 && seen.has(key)) return false;
    if (key.length > 80) seen.add(key);
    return true;
  });
}

function primaryPost(lesson) {
  const posts = meaningfulPosts(lesson);
  return posts.find((post) => (post.plain_text || "").length > 350 && !/^https?:\/\//.test((post.plain_text || "").trim())) || posts[0];
}

function renderOrientation(lesson) {
  const taxonomy = taxonomyFor(lesson);
  const activeAuthorId = taxonomy.authors.some((author) => author.id === state.activeAuthorId)
    ? state.activeAuthorId
    : taxonomy.authors[0]?.id || "";
  const orderedAuthors = [...taxonomy.authors].sort((a, b) => {
    if (a.id === activeAuthorId) return -1;
    if (b.id === activeAuthorId) return 1;
    return 0;
  });
  const genres = genreNodesFor(lesson);
  const unitMode = modeFor(lesson).startsWith("unit");
  const authorText = taxonomy.authors.map((author) => author.url
    ? `<a href="${esc(author.url)}" target="_blank" rel="noreferrer">${esc(author.name)}</a>`
    : `<span>${esc(author.name)}</span>`).join("、");
  const representativeText = taxonomy.representativeFigure
    ? `本頁人物視覺為 <a href="${esc(taxonomy.representativeFigure.url)}" target="_blank" rel="noreferrer">${esc(taxonomy.representativeFigure.name)}</a>（${esc(taxonomy.representativeFigure.role)}），不作課文作者歸屬。`
    : "";
  const bookText = taxonomy.sourceBooks.map((book) => `<a href="books.html?q=${encodeURIComponent(book)}" target="_blank" rel="noopener noreferrer">《${esc(book)}》</a>`).join("、");
  const relation = unitMode ? "先讀清篇目關係、學習動詞與成果標準。" : [
    `這是一篇 <a href="genres.html#${esc(genres[genres.length - 1]?.id || genres[0]?.id || "root")}" target="_blank" rel="noopener noreferrer">${esc(primaryGenreLabel(lesson))}</a>。`,
    authorText ? `作者 ${authorText}。` : "",
    bookText ? `課文選自 ${bookText}。` : "",
  ].filter(Boolean).join("");
  els.orientation.innerHTML = `<p class="orientation-line">${[relation, representativeText].filter(Boolean).join(" ")}</p>`;
  els.lessonPortraits.setAttribute("aria-label", taxonomy.authors.length ? "作者肖像" : taxonomy.representativeFigure ? taxonomy.representativeFigure.role : "人物視覺");
  els.lessonPortraits.innerHTML = taxonomy.authors.length ? orderedAuthors.map((author, index) => {
    const isNameCard = author.portraitKind === "documented-no-reliable-portrait";
    return `
    <button type="button" class="portrait-choice${isNameCard ? " name-card" : ""}" data-author-id="${esc(author.id)}" style="--portrait-index:${index}" aria-label="${isNameCard ? `${esc(author.name)}無可靠肖像姓名卡` : `切換至${esc(author.name)}`}" aria-pressed="${author.id === activeAuthorId ? "true" : "false"}">
      <span>${esc(author.name.slice(0, 1))}</span>
      ${author.url ? `<img src="https://qx.bdfz.net/img/figures/${encodeURIComponent(author.id)}.webp" alt="${isNameCard ? `${esc(author.name)}無可靠肖像姓名卡` : esc(author.name)}" loading="eager" onerror="this.remove()">` : ""}
      ${isNameCard ? "<small>無可靠肖像 · 姓名卡</small>" : ""}
      <b>${esc(author.name)}</b>
    </button>
  `; }).join("") : taxonomy.representativeFigure ? `
    <a class="portrait-choice representative-choice${taxonomy.representativeFigure.portraitKind === "documented-no-reliable-portrait" ? " name-card" : ""}" href="${esc(taxonomy.representativeFigure.url)}" target="_blank" rel="noopener noreferrer" aria-label="查看${esc(taxonomy.representativeFigure.name)}：${esc(taxonomy.representativeFigure.role)}">
      <span>${esc(taxonomy.representativeFigure.name.slice(0, 1))}</span>
      <img src="https://qx.bdfz.net/img/figures/${encodeURIComponent(taxonomy.representativeFigure.id)}.webp" alt="${esc(taxonomy.representativeFigure.name)}，${esc(taxonomy.representativeFigure.role)}" loading="eager" onerror="this.remove()">
      <small>${esc(taxonomy.representativeFigure.role)}</small>
      <b>${esc(taxonomy.representativeFigure.name)}</b>
    </a>
  ` : `<div class="portrait-constellation" aria-hidden="true"><i></i><i></i><i></i><span>${esc(primaryGenreLabel(lesson))}</span></div>`;
  $$('[data-author-id]', els.lessonPortraits).forEach((portrait) => portrait.addEventListener("click", () => {
    state.activeAuthorId = portrait.dataset.authorId || state.activeAuthorId;
    if (portrait !== els.lessonPortraits.firstElementChild) els.lessonPortraits.prepend(portrait);
    $$(".portrait-choice", els.lessonPortraits).forEach((item, index) => {
      item.style.setProperty("--portrait-index", index);
      item.setAttribute("aria-pressed", String(index === 0));
    });
    renderCheckStage(lesson);
  }));
}

function renderLessonMedia(lesson) {
  const firstRead = state.firstReads.get(lesson.id);
  if (sourceModeFor(lesson) === "classical" && firstRead && !firstRead.submitted) {
    els.lessonMediaSection.hidden = true;
    els.lessonMediaStatus.textContent = "初讀後解鎖";
    els.lessonMediaContent.innerHTML = "";
    return;
  }
  const media = state.lessonMedia.get(lesson.id);
  const ready = Boolean(media?.slideDeck);
  els.lessonMediaSection.hidden = !ready;
  els.lessonMediaStatus.textContent = ready ? "已展開預覽" : "";
  if (!ready) {
    els.lessonMediaContent.innerHTML = "";
    return;
  }
  const slideDeck = {
    href: media.slideDeck.href,
    title: media.slideDeck.title || "課堂簡報",
    kind: "document",
    disposition: "internal",
  };
  const plan = resourcePreviewPlan(slideDeck);
  els.lessonMediaContent.innerHTML = `
    <div class="lesson-media-grid">
      <article class="slide-deck-card">
        <header><span class="media-card-kicker">PDF · 頁內預覽</span><h3>${esc(slideDeck.title)}</h3></header>
        <div class="slide-deck-preview-frame" data-slide-preview>${previewPlaceholder(plan)}</div>
        <p class="preview-state-note" data-preview-note>${esc(plan.reason)}</p>
        ${previewFallback(plan, "另頁開啟簡報")}
      </article>
    </div>`;
  const host = $("[data-slide-preview]", els.lessonMediaContent);
  if (host) mountResourcePreview(host, plan, slideDeck.title, { eager: true });
}

function readerMediaMap(...collections) {
  return new Map(
    collections.flat().filter(Boolean).map((media) => [media.id, media]),
  );
}

function renderReaderMedia(media) {
  if (!media) return "";
  const label = esc(media.alt || "課文圖片");
  if (media.webDisposition !== "source-url" || !/^https:\/\//i.test(media.sourceUrl || "")) {
    return `<span class="reader-media-unavailable">${label}</span>`;
  }
  const dimensions = [
    media.width ? ` width="${Number(media.width)}"` : "",
    media.height ? ` height="${Number(media.height)}"` : "",
  ].join("");
  return `
    <a class="reader-media" href="${esc(media.sourceUrl)}" target="_blank" rel="noopener noreferrer">
      <img src="${esc(media.sourceUrl)}" alt="${label}"${dimensions} loading="lazy" decoding="async">
    </a>`;
}

function cleanReaderVisibleText(value) {
  return String(value || "")
    .replace(/\[color=[^\]]+\]|\[\/color\]/gi, "")
    .replace(/\[\d+:\d+\]/g, "")
    .replace(/\s+([，。；：！？])/g, "$1");
}

function annotationNumberMap(annotations) {
  return new Map((annotations || []).map((annotation, index) => [annotation.noteId, index + 1]));
}

function splitReaderAnnotationAnchor(value) {
  const text = cleanReaderVisibleText(value);
  const match = text.match(/^([\s\S]*?)([\p{Script=Han}][，。；：！？、）】》”’…—]*|[\p{L}\p{N}·_-]+[，。；：！？、）】》”’…—]*|\S)(\s*)$/u);
  return match
    ? { prefix: match[1], anchor: match[2], suffix: match[3] }
    : { prefix: text, anchor: "", suffix: "" };
}

function renderReaderAnnotationRef(run, options = {}) {
  const annotationNumbers = options.annotationNumbers || new Map();
  const annotationOccurrences = options.annotationOccurrences || (options.annotationOccurrences = new Map());
  const number = annotationNumbers.get(run.noteId);
  if (!number) return { marker: "", note: "" };
  const occurrence = (annotationOccurrences.get(run.noteId) || 0) + 1;
  annotationOccurrences.set(run.noteId, occurrence);
  const noteId = `reader-inline-note-${run.noteId}-${occurrence}`;
  const noteBody = options.annotationBodies?.get(run.noteId) || "";
  return {
    marker: `<sup class="reader-note-sup"><button class="reader-note-ref" type="button" data-note-ref="${esc(run.noteId)}" aria-expanded="false" aria-controls="${esc(noteId)}" aria-label="展開註釋 ${number}">${number}</button></sup>`,
    note: `<span class="reader-inline-note" id="${esc(noteId)}" data-inline-note role="note" hidden><span class="reader-inline-note-content">${noteBody}</span></span>`,
  };
}

function renderReaderTextWithAnnotations(run, annotationRuns, options = {}) {
  const value = cleanReaderVisibleText(run.text || run.sourceUrl || "外部資料");
  const { prefix, anchor, suffix } = splitReaderAnnotationAnchor(value);
  const renderValue = (part) => esc(part).replace(/\n/g, "<br>");
  const annotationParts = annotationRuns.map((annotation) => renderReaderAnnotationRef(annotation, options));
  const markerMarkup = annotationParts.map((part) => part.marker).join("");
  const noteMarkup = annotationParts.map((part) => part.note).join("");
  if (run.type === "link") {
    const href = projectStudentResourceHref(run.href || run.sourceUrl || "");
    const renderLink = (part) => {
      const body = renderValue(part);
      if (!body) return "";
      if (!href || run.disposition === "blocked-http") return `<span class="reader-link-blocked">${body}</span>`;
      return `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${body}</a>`;
    };
    return `${renderLink(prefix)}<span class="reader-annotation-anchor">${renderLink(anchor)}${markerMarkup}</span>${noteMarkup}${renderValue(suffix)}`;
  }
  return `${renderValue(prefix)}<span class="reader-annotation-anchor">${renderValue(anchor)}${markerMarkup}</span>${noteMarkup}${renderValue(suffix)}`;
}

function renderReaderRuns(runs, media, options = {}) {
  const output = [];
  const input = runs || [];
  for (let index = 0; index < input.length; index += 1) {
    const run = input[index];
    if (run.type === "text" || run.type === "link") {
      const annotationRuns = [];
      while (input[index + 1]?.type === "annotation-ref") {
        annotationRuns.push(input[index + 1]);
        index += 1;
      }
      if (annotationRuns.length) {
        output.push(renderReaderTextWithAnnotations(run, annotationRuns, options));
      } else if (run.type === "text") {
        output.push(esc(cleanReaderVisibleText(run.text)).replace(/\n/g, "<br>"));
      } else {
        const label = esc(cleanReaderVisibleText(run.text || run.sourceUrl || "外部資料"));
        const href = projectStudentResourceHref(run.href || run.sourceUrl || "");
        output.push(!href || run.disposition === "blocked-http"
          ? `<span class="reader-link-blocked">${label}</span>`
          : `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${label}</a>`);
      }
      continue;
    }
    if (run.type === "annotation-ref") {
      const annotation = renderReaderAnnotationRef(run, options);
      output.push(`<span class="reader-annotation-anchor">${annotation.marker}</span>${annotation.note}`);
    }
    else if (run.type === "media-ref") output.push(renderReaderMedia(media.get(run.mediaId)));
  }
  return output.join("");
}

function renderInlineAnnotationBlocks(blocks, media, options = {}) {
  return (blocks || []).map((block) => {
    if (block.type === "paragraph") {
      return `<span class="reader-inline-note-paragraph">${renderReaderRuns(block.runs, media, options)}</span>`;
    }
    if (block.type === "image") {
      return `<span class="reader-inline-note-media">${renderReaderMedia(media.get(block.mediaId))}</span>`;
    }
    return "";
  }).join("");
}

function inlineAnnotationBodies(annotations, media, annotationNumbers) {
  return new Map((annotations || []).map((annotation) => [
    annotation.noteId,
    renderInlineAnnotationBlocks(annotation.blocks, media, { annotationNumbers, annotationBodies: new Map() }),
  ]));
}

function renderReaderBlocks(blocks, media, options = {}) {
  return (blocks || []).map((block) => {
    if (block.type === "paragraph") return `<p>${renderReaderRuns(block.runs, media, options)}</p>`;
    if (block.type === "heading") {
      const level = Math.min(4, Math.max(2, Number(block.level) || 2));
      return `<h${level}>${renderReaderRuns(block.runs, media, options)}</h${level}>`;
    }
    if (block.type === "quote") {
      return `<blockquote>${renderReaderBlocks(block.blocks, media, options)}</blockquote>`;
    }
    if (block.type === "list") {
      const tag = block.ordered ? "ol" : "ul";
      return `<${tag}>${(block.items || []).map((item) => (
        `<li>${renderReaderBlocks(item.blocks, media, options)}</li>`
      )).join("")}</${tag}>`;
    }
    if (block.type === "image") return renderReaderMedia(media.get(block.mediaId));
    if (block.type === "resource-link") {
      if (options.includeResourceLinks === false) return "";
      const label = esc(cleanReaderVisibleText(block.text || "延伸資料"));
      const href = projectStudentResourceHref(block.href || block.sourceUrl || "");
      if (!href || !/^https:\/\//i.test(href) || /^blocked-/i.test(block.disposition || "")) {
        return `<p><span class="reader-link-blocked">${label}</span></p>`;
      }
      return `<p class="reader-resource-link"><a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${label} ↗</a></p>`;
    }
    if (block.type === "code") return `<pre><code>${esc(block.text || "")}</code></pre>`;
    if (block.type === "table") {
      return `<div class="reader-table-wrap"><table><tbody>${(block.rows || []).map((row) => (
        `<tr>${row.map((cell) => {
          const tag = cell.header ? "th" : "td";
          return `<${tag}>${renderReaderRuns(cell.runs, media, options)}</${tag}>`;
        }).join("")}</tr>`
      )).join("")}</tbody></table></div>`;
    }
    if (block.type === "divider") return "<hr>";
    return "";
  }).join("");
}

function renderReaderAnnotations(annotations, media, annotationNumbers = annotationNumberMap(annotations)) {
  if (!(annotations || []).length) return "";
  return `
    <section class="reader-annotations" aria-label="正文註釋">
      <h3>註釋</h3>
      <ol>
        ${annotations.map((annotation) => `
          <li id="reader-note-${esc(annotation.noteId)}" value="${annotationNumbers.get(annotation.noteId)}">
            ${renderReaderBlocks(annotation.blocks, media, { annotationNumbers })}
          </li>
        `).join("")}
      </ol>
    </section>`;
}

function renderLearningTip(tip) {
  if (!tip?.paragraphs?.length) return "";
  return `<aside class="reader-guidance classical-learning-tip" data-learning-tip aria-label="學習提示"><h3>學習提示</h3>${tip.paragraphs.map((paragraph) => `<p>${esc(paragraph)}</p>`).join("")}</aside>`;
}

function renderReaderDocument(document, canonicalAsset = null, learningTip = null) {
  const mainMedia = readerMediaMap(document.main?.media || []);
  const annotationNumbers = annotationNumberMap(document.main?.annotations || []);
  const annotationBodies = inlineAnnotationBodies(document.main?.annotations || [], mainMedia, annotationNumbers);
  const options = {
    annotationNumbers,
    annotationBodies,
    annotationOccurrences: new Map(),
    includeResourceLinks: false,
  };
  const approvedBlockIndexes = canonicalAsset
    ? new Set((canonicalAsset.paragraphs || []).map((paragraph) => Number(paragraph.sourceBlockIndex)))
    : null;
  const canonicalBlocks = approvedBlockIndexes
    ? (document.main?.blocks || []).filter((_block, index) => approvedBlockIndexes.has(index))
    : (document.main?.blocks || []);
  const frontMatter = canonicalAsset ? "" : renderReaderBlocks(document.main?.frontMatter || [], mainMedia, options);
  const guidance = canonicalAsset ? "" : renderReaderBlocks(document.main?.guidance || [], mainMedia, options);
  const body = renderReaderBlocks(canonicalBlocks, mainMedia, options);
  return `
    ${frontMatter ? `<aside class="reader-front-matter">${frontMatter}</aside>` : ""}
    ${guidance ? `<aside class="reader-guidance">${guidance}</aside>` : ""}
    ${renderLearningTip(learningTip)}
    <div class="primary-text reader-primary" data-post="${esc(document.main?.sourcePostNumber || document.main?.sourcePostId || "")}">
      ${body || `<p class="empty-state">本課正文請從教材原圖閱讀。</p>`}
    </div>`;
}

function renderText(lesson) {
  const firstRead = state.firstReads.get(lesson.id);
  if (sourceModeFor(lesson) === "classical" && firstRead && !firstRead.submitted) {
    els.textbookTitle.textContent = "起始 · 無注疏初讀";
    els.textFlow.innerHTML = window.YwClassicalFirstRead.renderGate(firstRead);
    window.YwClassicalFirstRead.bindGate(els.textFlow, firstRead, {
      toast,
      onChange: () => {
        lessonProgress(lesson.id).firstRead = {
          ...(lessonProgress(lesson.id).firstRead || {}),
          markCount: firstRead.marks.length,
          done: false,
        };
        syncProgress();
        renderCheckStage(lesson);
      },
      onUnlock: () => {
        lessonProgress(lesson.id).firstRead = {
          done: true,
          markCount: firstRead.marks.length,
          summary: firstRead.summary,
          textVersionId: firstRead.asset.textVersionId,
        };
        syncProgress({ event: true });
        els.body.classList.remove("first-read-locked");
        els.pageOpen.disabled = !state.pages.length;
        els.resourcesOpen.disabled = false;
        els.pageOpen.title = "";
        els.resourcesOpen.title = "";
        renderText(lesson);
        renderMaterials(lesson);
        renderLessonMedia(lesson);
        renderCheckStage(lesson);
        renderLessonChat(lesson);
        renderMatrix(lesson);
        toast("初讀已保存；正文與隨文註釋已展開，讀完後解鎖查詞");
        document.querySelector("#textbook-text")?.scrollIntoView({ behavior: "smooth", block: "start" });
      },
    });
    return;
  }
  els.textbookTitle.textContent = sourceModeFor(lesson) === "classical" ? "帶註釋正文" : "細讀";
  if (lesson.readerDocument?.schemaVersion === "yw-reader-document-v1") {
    const learningTip = state.classicalLearningTips.get(lesson.id) || null;
    const submittedFirstRead = sourceModeFor(lesson) === "classical" && firstRead?.submitted
      ? window.YwClassicalFirstRead.renderSubmittedReading(firstRead)
      : "";
    const reader = renderReaderDocument(lesson.readerDocument, firstRead?.asset || null, learningTip);
    const annotatedCompletion = sourceModeFor(lesson) === "classical" && firstRead?.submitted
      ? (firstRead.annotatedReadCompleted
        ? `<section class="annotated-read-completion complete" aria-label="帶註釋正文已讀完"><strong>帶註釋正文已讀完</strong><p>詞級疏通與查詞已解鎖，可回到下方關卡繼續。</p></section>`
        : `<section class="annotated-read-completion" aria-label="完成帶註釋正文閱讀"><strong>先讀完正文與隨文註釋</strong><p>註釋默認隱藏，點上標數字展開，再點即可收起。讀完後再進入詞級疏通。</p><button type="button" data-annotated-read-complete>我已讀完帶註釋正文，進入詞級疏通</button></section>`)
      : "";
    els.textFlow.innerHTML = `${submittedFirstRead}${reader}${annotatedCompletion}`;
    return;
  }
  els.textFlow.innerHTML = `<p class="empty-state">課文暫時無法顯示。</p>`;
}

async function completeAnnotatedReading(button) {
  const lesson = state.current;
  const session = state.firstReads.get(lesson?.id);
  if (!lesson || !session?.submitted || session.annotatedReadCompleted) return;
  button.disabled = true;
  button.textContent = "正在保存閱讀確認…";
  const clientMutationId = `annotated-read:${lesson.id}:${session.asset.textVersionId}`.slice(0, 100);
  const result = await recordLearning(
    "readAcknowledged",
    { threshold: 1 },
    { clientMutationId, lessonPhase: "annotated_reading" },
  );
  if (state.current?.id !== lesson.id) return;
  if (result?.ok !== true) {
    button.disabled = false;
    button.textContent = "我已讀完帶註釋正文，進入詞級疏通";
    toast(result?.reason === "anonymous" ? "請先登入，再保存帶註釋閱讀進度" : "閱讀確認尚未保存，請稍後重試");
    return;
  }
  session.annotatedReadCompleted = true;
  renderText(lesson);
  renderCheckStage(lesson);
  renderMatrix(lesson);
  renderMastery();
  toast("帶註釋正文已讀完；詞級疏通與查詞已解鎖");
  document.querySelector('[data-round="vocabulary"]')?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function absoluteResourceUrl(raw) {
  try { return new URL(raw, FORUM_ORIGIN).toString(); } catch { return raw || ""; }
}

function resourceTitle(resource, url) {
  const text = String(resource.text || resource.title || "").trim();
  if (text && !/^https?:\/\//i.test(text)) return text.replace(/\s*\([^)]*(KB|MB|GB)\)\s*$/i, "");
  try {
    return decodeURIComponent(new URL(url).pathname.split("/").filter(Boolean).pop() || new URL(url).hostname);
  } catch {
    return "學習資料";
  }
}

const RESOURCE_TRACKING_KEYS = new Set(["spm", "fbclid", "gclid", "dclid", "msclkid", "mc_cid", "mc_eid"]);

function resourceIdentity(href) {
  try {
    const normalized = new URL(href, FORUM_ORIGIN);
    normalized.hash = "";
    for (const key of [...normalized.searchParams.keys()]) {
      if (/^utm_/i.test(key) || RESOURCE_TRACKING_KEYS.has(key.toLowerCase())) {
        normalized.searchParams.delete(key);
      }
    }
    return normalized.toString();
  } catch {
    return String(href || "").replace(/#.*$/, "");
  }
}

const REMOVED_WEB_RESOURCE_KEYS = new Set([
  "www.bilibili.com/video/bv1zg4y1h7fk",
  "baike.baidu.com/item/%E6%9C%89%E6%84%9F",
  "aistudio.google.com/app/prompts",
  "aistudio.google.com/app/prompts/new_chat",
  "chat.deepseek.com/",
  "claude.ai/",
  "forum.rdfzer.com/c/general/4",
  "grok.com/",
  "labs.google/fx/tools/flow/unsupported-country",
  "mf.bdfzer.com/",
  "pkuschool.yuque.com/search?q=%E6%AF%94%E5%85%B4&type=content&scope=qrvbic&tab=group&p=1&sence=modal",
  "sites.google.com/view/pkuschool/cover3/xbs1/xbs4",
  "sites.google.com/view/pkuschool/cover3/xbs1/xbs6/xbs7",
  "www.digital.archives.go.jp/DAS/meta/listPhoto?LANG=eng&BID=F1000000000000107520&ID=&TYPE=dljpeg",
  "www.scdfz.org.cn/ztzl/hjczzsc/zzhy/content_30068",
  "z-library.sk/book/30273234/d175b9/%E5%A4%A7%E5%94%90%E7%AC%AC%E4%B8%80%E5%8F%A4%E6%83%91%E4%BB%94%E6%9D%8E%E7%99%BD%E5%AE%9E%E5%BD%95.html?ts=0729",
  "z-library.sk/book/41748134/f80433/%E9%97%BB%E4%B8%80%E5%A4%9A%E5%85%A8%E9%9B%86-6-%E5%94%90%E8%AF%97%E7%BC%96-%E4%B8%8A.html?ts=0929",
  "zh.m.wikipedia.org/w/index.php?title=%E9%B2%81%E8%BF%85%E4%BC%A0&action=edit&redlink=1",
  "zh.wikisource.org/w/index.php?title=%E5%A4%AA%E7%99%BD&action=edit&redlink=1",
]);

function webResourceKey(raw) {
  try {
    const url = raw instanceof URL
      ? new URL(raw.toString())
      : new URL(String(raw || "").replaceAll("&amp;", "&"));
    if (!["http:", "https:"].includes(url.protocol)) return "";
    url.hash = "";
    const hostname = url.hostname.toLowerCase();
    const port = url.port ? `:${url.port}` : "";
    let pathname = url.pathname || "/";
    if (pathname !== "/") pathname = pathname.replace(/\/+$/, "");
    pathname = pathname.replace(/%[0-9a-f]{2}/gi, (escape) => escape.toUpperCase());
    const search = url.search.replace(/%[0-9a-f]{2}/gi, (escape) => escape.toUpperCase());
    if (
      hostname === "www.bilibili.com"
      && pathname.toLowerCase() === "/video/bv1zg4y1h7fk"
    ) return "www.bilibili.com/video/bv1zg4y1h7fk";
    return `${hostname}${port}${pathname}${search}`;
  } catch {
    return "";
  }
}

function isRemovedWebResource(raw) {
  try {
    const url = raw instanceof URL ? raw : new URL(String(raw || ""), location.href);
    if (url.hostname.toLowerCase() === "xue.bdfz.net") return true;
  } catch {
    return false;
  }
  const key = webResourceKey(raw);
  return Boolean(key && REMOVED_WEB_RESOURCE_KEYS.has(key));
}

function projectStudentResourceHref(rawHref) {
  const href = rawHref ? absoluteResourceUrl(rawHref) : "";
  if (!href) return "";
  try {
    const url = new URL(href, location.href);
    if (url.hostname.toLowerCase() === "bdfz.yuque.com" || isRemovedWebResource(url)) return "";
  } catch {
    return "";
  }
  return state.wechatArchiveBySource.get(resourceIdentity(href))?.archiveUrl || href;
}

function previewScreenshotFor(href) {
  return state.previewScreenshotBySource.get(resourceIdentity(href)) || null;
}

function directRemoteAppRootFor(href) {
  try {
    const url = new URL(href);
    if (url.search || url.pathname !== "/") return "";
    if (
      url.hash
      && (
        url.hostname.toLowerCase() !== "qx.bdfz.net"
        || !/^#[A-Za-z0-9_-]{1,80}$/.test(url.hash)
      )
    ) return "";
    const normalized = `${url.origin}/`;
    return state.directRemoteAppRoots.has(normalized) ? url.toString() : "";
  } catch {
    return "";
  }
}

function resourcePreviewPlan(resource) {
  const rawHref = String(resource?.href || resource?.sourceUrl || "").trim();
  if (!rawHref) {
    return { mode: "unavailable", externalHref: "", reason: "來源沒有提供可開啟地址，資料條目仍予保留。" };
  }
  let url;
  try { url = new URL(rawHref, location.href); } catch {
    return { mode: "unavailable", externalHref: "", reason: "來源地址格式無法辨識，資料條目仍予保留。" };
  }
  if (!["http:", "https:"].includes(url.protocol)) {
    return { mode: "unavailable", externalHref: "", reason: `不支援 ${url.protocol || "未知"} 協議，未載入頁內預覽。` };
  }
  const externalHref = url.toString();
  const fallbackScreenshotSrc = previewScreenshotFor(externalHref)?.screenshotUrl || "";
  const disposition = String(resource?.disposition || "").toLowerCase();
  const hostname = url.hostname.toLowerCase();
  const pathname = url.pathname.toLowerCase();
  const extension = pathname.match(/\.([a-z0-9]{2,5})$/)?.[1] || "";
  const externalOnly = (reason) => ({ mode: "external-only", externalHref, fallbackScreenshotSrc, reason });

  if (url.protocol !== "https:" && url.origin !== location.origin) {
    return externalOnly("來源僅提供 HTTP；為避免不安全的混合內容，頁內不載入，仍可另頁開啟原始地址。");
  }
  if (disposition === "source-only") return externalOnly("此條目只保留原始出處，沒有可驗證的頁內版本。");
  if (disposition.startsWith("blocked-")) return externalOnly("來源審核狀態不允許頁內載入，仍保留原始地址供核對。");
  if (hostname === "accounts.google.com") return externalOnly("此來源要求外部帳號登入，不能在課文頁內安全預覽。");
  if (hostname === "sites.google.com" && fallbackScreenshotSrc) {
    return {
      mode: "image",
      src: fallbackScreenshotSrc,
      externalHref,
      fallbackScreenshotSrc: "",
      reason: "Google Sites 不允許可靠內嵌；此處顯示已核對的完整頁面截圖，可放大查看或另頁打開原站。",
      screenshot: true,
    };
  }
  if (hostname === "zh.wikisource.org" && fallbackScreenshotSrc) {
    return {
      mode: "image",
      src: fallbackScreenshotSrc,
      externalHref,
      fallbackScreenshotSrc: "",
      reason: "維基文庫的完整遠頁不適合經代理重排；此處顯示已核對的正文截圖，可放大查看或另頁打開原站。",
      screenshot: true,
    };
  }
  const directRemoteRoot = directRemoteAppRootFor(externalHref);
  if (directRemoteRoot) {
    return {
      mode: "remote-app",
      src: directRemoteRoot,
      externalHref: directRemoteRoot,
      fallbackScreenshotSrc,
      reason: "已直接載入經審核的 BDFZ 遠端網站；放大後仍是同一個即時網站。",
    };
  }
  if (hostname === "www.youtube.com" || hostname === "youtube.com" || hostname === "youtu.be") {
    const videoId = hostname === "youtu.be"
      ? pathname.split("/").filter(Boolean)[0]
      : url.searchParams.get("v");
    if (videoId && /^[\w-]{6,20}$/.test(videoId)) {
      return {
        mode: "youtube",
        src: `https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoId)}?rel=0&playsinline=1`,
        posterSrc: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
        externalHref,
        fallbackScreenshotSrc,
        reason: "點擊畫面即可直接播放；也可放大觀看。",
      };
    }
    return externalOnly("影片頁不能安全嵌入，請另頁觀看。");
  }
  if (hostname === "forum.rdfzer.com" && pathname.startsWith("/u/")) {
    return externalOnly("這是討論者個人頁，不是可內嵌教材；保留另頁核對入口。");
  }
  if (hostname === "blogger.googleusercontent.com") {
    return { mode: "image", src: externalHref, externalHref, fallbackScreenshotSrc, reason: "圖片已直接展開；若載入失敗可打開原圖。" };
  }
  if (["png", "jpg", "jpeg", "gif", "webp", "svg", "avif"].includes(extension)) {
    return { mode: "image", src: externalHref, externalHref, fallbackScreenshotSrc, reason: "圖片已直接展開；若載入失敗可打開原圖。" };
  }
  if (["mp3", "wav", "m4a", "ogg", "flac"].includes(extension)) {
    return { mode: "audio", src: externalHref, externalHref, fallbackScreenshotSrc, reason: "音訊已直接展開；若來源限制播放可另頁開啟。" };
  }
  if (["mp4", "webm", "mov"].includes(extension)) {
    return { mode: "video", src: externalHref, externalHref, fallbackScreenshotSrc, reason: "影片已直接展開；若來源限制播放可另頁開啟。" };
  }
  if (extension === "pdf" || resource?.kind === "document") {
    return { mode: "document", src: resourcePreviewUrl(externalHref), externalHref, fallbackScreenshotSrc, reason: "PDF 已展開；若瀏覽器不支援內嵌閱讀可另頁開啟。" };
  }
  return {
    mode: "iframe",
    src: resourcePreviewUrl(externalHref),
    externalHref,
    fallbackScreenshotSrc,
    reason: "已展開頁內預覽；若來源登入或防嵌入策略令畫面空白，請打開原頁。",
  };
}

function previewFallback(plan, label = "打開原頁") {
  return plan.externalHref
    ? `<a class="preview-open" href="${esc(plan.externalHref)}" target="_blank" rel="noopener noreferrer">${esc(label)} ↗</a>`
    : `<span class="preview-no-source">沒有可安全開啟的來源地址</span>`;
}

function previewPlaceholder(plan) {
  if (plan.mode === "external-only" || plan.mode === "unavailable") {
    return `<div class="preview-unavailable"><strong>${plan.mode === "external-only" ? "僅可另頁開啟" : "預覽未提供"}</strong><p>${esc(plan.reason)}</p></div>`;
  }
  return `<p>正在準備預覽…</p>`;
}

function screenshotFallbackPlan(plan, reason = "即時頁面目前無法顯示；已切換到經驗證的本機頁面截圖。") {
  if (!plan.fallbackScreenshotSrc) return null;
  return {
    mode: "image",
    src: plan.fallbackScreenshotSrc,
    externalHref: plan.externalHref,
    fallbackScreenshotSrc: "",
    reason,
    screenshot: true,
  };
}

async function previewTextSample(response, maxBytes = 96_000) {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  try {
    while (bytes < maxBytes) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      text += decoder.decode(chunk.value, { stream: true });
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return text.replace(/<[^>]+>/g, " ").replace(/&nbsp;|&#160;/g, " ").replace(/\s+/g, " ").trim();
}

async function inlinePreviewUsable(src) {
  try {
    const response = await fetch(src, {
      cache: "no-store",
      headers: { accept: "text/html,application/xhtml+xml,*/*" },
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      return false;
    }
    const type = String(response.headers.get("content-type") || "").toLowerCase();
    if (!type.includes("text/html") && !type.includes("application/xhtml+xml")) {
      await response.body?.cancel().catch(() => {});
      return true;
    }
    const sample = await previewTextSample(response);
    if (sample.length < 80) return false;
    if (/(?:preview upstream unavailable|url is not registered|access denied|error\s+(?:4\d\d|5\d\d)|page not found|頁面不存在|页面不存在|找不到网页|just a moment|verify you are human)/i.test(sample.slice(0, 5_000))) return false;
    if (sample.length < 1_600 && /(?:sign in|log in|登\s*[录錄入]|扫码登录|掃碼登錄|請先登入|请先登录)/i.test(sample.slice(0, 5_000))) return false;
    return true;
  } catch {
    return false;
  }
}

function mountResourcePreview(host, plan, title, { eager = false, expanded = false, preflight = true } = {}) {
  const note = host.closest("article")?.querySelector("[data-preview-note]");
  const updateNote = (message) => { if (note) note.textContent = message; };
  const appendExpandButton = () => {
    if (expanded) return;
    const expand = document.createElement("button");
    expand.type = "button";
    expand.className = "preview-expand";
    expand.textContent = "放大";
    expand.setAttribute("aria-label", `放大預覽：${title}`);
    expand.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      openResourcePlan(plan, title);
    });
    host.append(expand);
  };
  updateNote(plan.reason);
  host.dataset.previewMode = plan.mode;
  if (plan.mode === "external-only" || plan.mode === "unavailable") {
    host.innerHTML = previewPlaceholder(plan);
    host.dataset.previewState = plan.mode;
    return;
  }
  if (preflight && plan.mode === "iframe" && String(plan.src || "").startsWith("/api/preview?")) {
    host.innerHTML = "<p>正在檢查頁內預覽…</p>";
    host.dataset.previewState = "loading";
    void inlinePreviewUsable(plan.src).then((usable) => {
      if (!host.isConnected) return;
      if (usable) {
        mountResourcePreview(host, plan, title, { eager, expanded, preflight: false });
        return;
      }
      const fallback = screenshotFallbackPlan(plan);
      if (fallback) {
        mountResourcePreview(host, fallback, title, { eager: true, expanded, preflight: false });
        return;
      }
      updateNote("即時頁面目前無法顯示，且沒有經驗證的本機截圖；已停止嵌入，請使用原頁連結。");
      host.innerHTML = previewPlaceholder({
        mode: "external-only",
        externalHref: plan.externalHref,
        reason: "即時頁面目前無法顯示，且沒有經驗證的本機截圖。",
      });
      host.dataset.previewState = "external-only";
    });
    return;
  }
  if (plan.mode === "youtube" && !eager) {
    const play = document.createElement("button");
    play.type = "button";
    play.className = "youtube-preview-play";
    play.setAttribute("aria-label", `播放影片：${title}`);
    const poster = document.createElement("img");
    poster.src = plan.posterSrc;
    poster.alt = "";
    poster.decoding = "async";
    const label = document.createElement("span");
    label.textContent = "播放";
    play.append(poster, label);
    play.addEventListener("click", () => {
      const autoplay = new URL(plan.src);
      autoplay.searchParams.set("autoplay", "1");
      mountResourcePreview(
        host,
        { ...plan, src: autoplay.toString() },
        title,
        { eager: true, expanded, preflight: false },
      );
    }, { once: true });
    host.replaceChildren(play);
    host.classList.add("preview-host");
    host.dataset.previewState = "ready";
    appendExpandButton();
    return;
  }
  let element;
  if (plan.mode === "image") {
    element = document.createElement("img");
    element.alt = title;
    element.decoding = "async";
  } else if (plan.mode === "audio") {
    element = document.createElement("audio");
    element.controls = true;
    element.preload = "metadata";
  } else if (plan.mode === "video") {
    element = document.createElement("video");
    element.controls = true;
    element.preload = "metadata";
  } else {
    element = document.createElement("iframe");
    element.title = `預覽：${title}`;
    element.loading = eager ? "eager" : "lazy";
    element.referrerPolicy = "strict-origin-when-cross-origin";
    if (plan.mode !== "document") {
      const sandbox = ["remote-app", "youtube"].includes(plan.mode)
        ? "allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-presentation"
        : "allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox";
      element.setAttribute("sandbox", sandbox);
    }
    if (plan.mode === "youtube") {
      element.allow = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share";
      element.allowFullscreen = true;
    }
  }
  element.addEventListener("load", () => {
    host.dataset.previewState = plan.screenshot ? "screenshot" : "loaded";
    updateNote(plan.reason);
  }, { once: true });
  element.addEventListener("error", () => {
    const fallback = screenshotFallbackPlan(plan);
    if (fallback) {
      mountResourcePreview(host, fallback, title, { eager: true, expanded, preflight: false });
      return;
    }
    host.dataset.previewState = "failed";
    updateNote("來源拒絕或無法載入頁內預覽；請使用下方原頁連結。");
  }, { once: true });
  element.src = plan.src;
  host.replaceChildren(element);
  host.classList.add("preview-host");
  if (plan.screenshot) {
    host.dataset.previewState = "screenshot";
    updateNote(plan.reason);
  }
  appendExpandButton();
  if (!plan.screenshot) host.dataset.previewState = "loading";
}

function isNonContentResource(href, disposition = "") {
  try {
    const url = new URL(href, location.href);
    if (url.hostname === "bdfz.yuque.com") return true;
    if (isRemovedWebResource(url)) return true;
    if (url.hostname === "accounts.google.com") return true;
    if (url.hostname === "forum.rdfzer.com" && url.pathname.startsWith("/u/")) return true;
    if (url.protocol === "http:" && url.origin !== location.origin) return true;
  } catch {
    return true;
  }
  return disposition === "source-only" || String(disposition).startsWith("blocked-");
}

function resourcesFor(lesson) {
  const seen = new Set();
  const readerDocument = lesson.readerDocument?.schemaVersion === "yw-reader-document-v1"
    ? lesson.readerDocument
    : null;
  const readerResourceLinks = [];
  const collectReaderResourceLinks = (value) => {
    if (Array.isArray(value)) {
      value.forEach(collectReaderResourceLinks);
      return;
    }
    if (!value || typeof value !== "object") return;
    if (value.type === "resource-link") readerResourceLinks.push(value);
    Object.values(value).forEach(collectReaderResourceLinks);
  };
  if (readerDocument) {
    collectReaderResourceLinks(readerDocument.main?.blocks || []);
    for (const post of readerDocument.supplementary || []) {
      collectReaderResourceLinks(post.blocks || []);
    }
  }
  const source = readerDocument
    ? [
      ...(readerDocument.resources || []).map((resource) => ({
      href: resource.href,
      text: resource.label,
      title: resource.label,
      kind: resource.kind,
      postNumber: resource.postNumber,
      disposition: resource.disposition,
      sourceUrl: resource.sourceUrl,
      })),
      ...readerResourceLinks,
    ]
    : (lesson.resources || []);
  return source.reduce((items, resource) => {
    const sourceHref = resource.href || resource.sourceUrl || "";
    const originalHref = sourceHref ? absoluteResourceUrl(sourceHref) : "";
    if (isNonContentResource(originalHref, resource.disposition || "")) return items;
    const archive = state.wechatArchiveBySource.get(resourceIdentity(originalHref));
    const href = projectStudentResourceHref(originalHref);
    const key = href ? resourceIdentity(href) : `missing:${resourceTitle(resource, "")}:${resource.postNumber || ""}`;
    if (seen.has(key)) return items;
    seen.add(key);
    if (archive) seen.add(resourceIdentity(originalHref));
    items.push({
      href,
      title: archive?.title || resourceTitle(resource, href),
      kind: resource.kind || (/\.pdf(?:$|\?)/i.test(href) ? "document" : "link"),
      postNumber: resource.postNumber,
      disposition: resource.disposition || "",
      sourceUrl: archive ? originalHref : (resource.sourceUrl || ""),
    });
    return items;
  }, []);
}

function renderSupplementaryMaterials(lesson) {
  const supplementary = lesson.readerDocument?.schemaVersion === "yw-reader-document-v1"
    ? lesson.readerDocument.supplementary || []
    : [];
  return supplementary.map((post, index) => {
    const media = readerMediaMap(post.media || []);
    const annotationNumbers = annotationNumberMap(post.annotations || []);
    const annotationBodies = inlineAnnotationBodies(post.annotations || [], media, annotationNumbers);
    return `
      <section class="extension-reading reader-supplementary">
        <header><span>補充閱讀 ${index + 1}</span><b>已展開預覽</b></header>
        <div class="extension-body">
          ${renderReaderBlocks(post.blocks || [], media, { annotationNumbers, annotationBodies })}
        </div>
      </section>`;
  }).join("");
}

function renderMaterials(lesson) {
  const firstRead = state.firstReads.get(lesson.id);
  if (sourceModeFor(lesson) === "classical" && firstRead && !firstRead.submitted) {
    els.materialsSection.hidden = true;
    els.materialsCount.textContent = "初讀後解鎖";
    els.materialStream.innerHTML = "";
    return;
  }
  const resources = resourcesFor(lesson);
  const supplementary = lesson.readerDocument?.supplementary || [];
  const count = resources.length + supplementary.length;
  els.materialsSection.hidden = count === 0;
  els.materialsCount.textContent = count ? `${count} 項` : "";
  els.materialStream.innerHTML = count ? `
    ${renderSupplementaryMaterials(lesson)}
    ${resources.length ? `<div class="material-preview-list">
      ${resources.map((resource, index) => {
        const plan = resourcePreviewPlan(resource);
        return `
        <article class="material-preview-card" data-resource-preview-index="${index}">
          <header><span>${String(index + 1).padStart(2, "0")}</span><strong>${esc(resource.title)}</strong><small>${plan.mode === "external-only" || plan.mode === "unavailable" ? "僅外開" : "已展開"}</small></header>
          <div class="material-preview-frame" data-material-preview="${index}">${previewPlaceholder(plan)}</div>
          <p class="preview-state-note" data-preview-note>${esc(plan.reason)}</p>
          ${previewFallback(plan)}
        </article>
      `; }).join("")}
    </div>` : ""}
  ` : "";
  activateMaterialPreviews(resources);
}

function activateMaterialPreviews(resources) {
  $$('[data-material-preview]', els.materialStream).forEach((host) => {
    const resource = resources[Number(host.dataset.materialPreview)];
    if (!resource) return;
    mountResourcePreview(host, resourcePreviewPlan(resource), resource.title);
  });
}

function lessonVocabulary(lesson) {
  const posts = meaningfulPosts(lesson);
  const primary = primaryPost(lesson);
  if (!primary) return [];
  const sources = [
    primary,
    ...posts.filter((post) => (
      post !== primary &&
      (post.plain_text || "").length > 180 &&
      !(post.attachments || []).length
    )).slice(0, 8),
  ];
  const items = [];
  sources.forEach((post) => {
    const doc = new DOMParser().parseFromString(`<div>${post.cooked || ""}</div>`, "text/html");
    $$('.footnote-ref', doc).forEach((reference) => {
      const link = reference.querySelector('a[href^="#"]');
      const id = link?.getAttribute("href")?.slice(1) || "";
      const item = id ? doc.getElementById(id) : null;
      if (!item) return;
      const clone = item.cloneNode(true);
      $$('.footnote-backref', clone).forEach((node) => node.remove());
      const parsed = annotationParts(clone.textContent || "");
      const word = /^[\p{Script=Han}·]{1,10}$/u.test(parsed.word)
        ? parsed.word
        : precedingAnnotationWord(reference);
      if (!word) return;
      items.push({ id, word, note: parsed.note || cleanAnnotationText(clone.textContent || "") });
    });
  });
  return items.filter((item) => /^[\p{Script=Han}·]{1,10}$/u.test(item.word))
    .filter((item, index, all) => all.findIndex((other) => other.word === item.word) === index);
}

function blueprintContext(lesson) {
  return {
    lessonId: lesson.id,
    lessonTitle: lessonTitle(lesson),
    blockTitle: lesson.blockTitle || "",
    mode: modeFor(lesson),
    excerpt: String(primaryPost(lesson)?.plain_text || lesson.excerpt || "").slice(0, 3600),
  };
}

function blueprintFallback(lesson) {
  if (!lessonBlueprintRules?.deterministicLessonBlueprint) {
    throw new Error("lesson blueprint rules are unavailable");
  }
  return lessonBlueprintRules.deterministicLessonBlueprint(blueprintContext(lesson));
}

async function ensureBlueprint(lesson) {
  const key = blueprintKey(lesson);
  if (state.blueprints.has(key) || state.blueprintLoading.has(key)) return;
  state.blueprintLoading.add(key);
  try {
    const response = await fetch("/api/lesson-blueprint", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        lessonId: lesson.id,
        lessonTitle: lessonTitle(lesson),
        blockTitle: lesson.blockTitle || "",
        mode: modeFor(lesson),
        genres: genreNodesFor(lesson).map((genre) => genre.label),
        authors: [authorNameFor(lesson)],
        excerpt: String(primaryPost(lesson)?.plain_text || lesson.excerpt || "").slice(0, 3600),
      }),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "blueprint unavailable");
    state.blueprints.set(key, payload.blueprint || blueprintFallback(lesson));
  } catch {
    state.blueprints.set(key, blueprintFallback(lesson));
  } finally {
    state.blueprintLoading.delete(key);
    if (state.current?.id === lesson.id) renderCheckStage(lesson);
  }
}

function interactionResult(progress, key) {
  const result = progress[key]?.result;
  if (!result) return "";
  const evidenceStatus = progress[key]?.evidenceStatus;
  const evidenceLabel = evidenceStatus === "anonymous"
    ? '<em class="interaction-evidence-status anonymous">試做回饋 · 未記錄</em>'
    : evidenceStatus === "ineligible"
      ? '<em class="interaction-evidence-status ineligible">已記錄 · 不計入本次完成</em>'
      : evidenceStatus === "recorded"
        ? '<em class="interaction-evidence-status recorded">已記錄到正式學習證據</em>'
        : "";
  return `<div class="interaction-result"><header><strong>${esc(result.verdict)}</strong><span>${esc(result.score)} / 100</span></header>${evidenceLabel}<p>${esc(result.strength)}</p><p><b>還差一步：</b>${esc(result.gap)}</p><p><b>追問：</b>${esc(result.nextQuestion)}</p></div>`;
}

function authorDialogue(lesson, body, result = "", action = "") {
  const author = activeAuthorFor(lesson);
  const name = authorNameFor(lesson);
  return `<div class="author-dialog" data-author-dialog="${esc(name)}">
    <div class="author-dialog-head">
      <span class="author-dialog-avatar">${author?.url ? `<img src="https://qx.bdfz.net/img/figures/${encodeURIComponent(author.id)}.webp" alt="" onerror="this.remove()">` : ""}<b>${esc(name.slice(0, 1))}</b></span>
      <strong>${esc(name)}</strong>
    </div>
    <div class="author-dialog-body">${body}${result}</div>
    ${action ? `<div class="dialog-action-row">${action}</div>` : ""}
  </div>`;
}

// ---------- 字詞題庫（結構化詞級疏通；無題庫課文回退註詞逐查） ----------
async function ensureVocabBank(lesson) {
  const id = lesson?.id;
  if (!id || state.vocabBanks.has(id) || state.vocabBankLoading.has(id)) return;
  if (!lessonHasVocabulary(lesson)) {
    state.vocabBanks.set(id, null);
    return;
  }
  state.vocabBankLoading.add(id);
  try {
    const response = await fetch(`data/vocab/${encodeURIComponent(id)}.json`);
    if (!response.ok) throw new Error(String(response.status));
    const bank = await response.json();
    const questions = (bank.inventory || []).filter((item) => item.decision === "question");
    state.vocabBanks.set(id, questions.length ? { ...bank, questions } : null);
  } catch {
    state.vocabBanks.set(id, null);
  } finally {
    state.vocabBankLoading.delete(id);
    if (state.current?.id === id) renderCheckStage(state.current);
  }
}

function quizRecord(progress) {
  progress.vocabularyQuiz ||= { answers: {} };
  progress.vocabularyQuiz.answers ||= {};
  return progress.vocabularyQuiz;
}

function quizItemState(quiz, itemId) {
  return quiz.answers[itemId] || { attempts: 0, correct: false, mastered: false };
}

function quizSolvedCount(quiz, questions) {
  return questions.filter((item) => quizItemState(quiz, item.id).correct).length;
}

function markSentence(sentence, word) {
  const escaped = esc(sentence);
  const target = esc(word || "");
  if (!target || !escaped.includes(target)) return escaped;
  return escaped.replace(target, `<mark>${target}</mark>`);
}

const QUIZ_TYPE_LABEL = {
  "contextual-choice": "語境義", "gu-jin": "古今異義", substitution: "換詞判斷",
  discrimination: "近義辨析", usage: "用法", pronunciation: "讀音",
  interpretation: "句意", evidence: "原文定位",
};

function renderVocabularyQuiz(lesson, progress, bank) {
  const quiz = quizRecord(progress);
  const questions = bank.questions;
  const solved = quizSolvedCount(quiz, questions);
  let current = questions.find((item) => item.id === quiz.cursorId) || null;
  if (!current) current = questions.find((item) => !quizItemState(quiz, item.id).correct) || null;
  const percent = Math.round(solved / questions.length * 100);
  const formal = (current ? [current] : questions).every((item) =>
    window.YwVocabProgress?.isFormalVocabularyQuestion?.(
      state.formalVocabResourceKeys,
      lesson.id,
      item.id,
    ) === true
  );
  const header = `<div class="vocabulary-progress" aria-label="字詞題 ${solved} / ${questions.length}"><span></span><b>${solved} / ${questions.length}</b></div>
    <p class="vocabulary-evidence-mode">${formal ? "本課字詞結果同步至正式學習證據。" : "本課字詞保留為本機練習，不計入正式 A+ 題目。"}</p>`;
  if (!current) {
    const firstTry = questions.filter((item) => quizItemState(quiz, item.id).mastered).length;
    return `<div class="vocabulary-step vocab-quiz" style="--vocabulary-progress:${percent}%">${header}
      <p class="vocabulary-complete">字詞題全部過關：${questions.length} 題，其中 ${firstTry} 題一次答對。</p>
    </div>${sourceModeFor(lesson) === "poetry" ? renderWordCreation(lesson, progress) : ""}`;
  }
  const itemState = quizItemState(quiz, current.id);
  const answered = itemState.lastPick;
  const showExplain = itemState.attempts > 0;
  return `<div class="vocabulary-step vocab-quiz" style="--vocabulary-progress:${percent}%">${header}
    <div class="quiz-item" data-quiz-item="${esc(current.id)}">
      <p class="quiz-kicker"><b>${esc(QUIZ_TYPE_LABEL[current.type] || "字詞")}</b><i>難度 ${"◆".repeat(current.difficulty || 1)}</i><button type="button" class="quiz-lookup" data-quiz-lookup="${esc(current.word)}">查「${esc(current.word)}」</button></p>
      ${current.sourceSentence ? `<p class="quiz-sentence">${markSentence(current.sourceSentence, current.word)}</p>` : ""}
      <p class="quiz-question">${esc(current.question)}</p>
      <div class="quiz-options">${current.options.map((option, index) => {
        const picked = answered === index;
        const isAnswer = index === current.answerIndex;
        const tone = picked ? (isAnswer ? "correct" : "wrong") : (showExplain && isAnswer && itemState.revealed ? "correct" : "");
        return `<button type="button" data-quiz-option="${index}" class="${tone}">${esc(option)}</button>`;
      }).join("")}</div>
      ${itemState.correct || itemState.lastAnswerCorrect || itemState.revealed
        ? `<div class="quiz-explain ${itemState.correct || itemState.lastAnswerCorrect ? "good" : ""}">${itemState.correct ? "✓ 本題已完成。" : itemState.lastAnswerCorrect ? "✓ 本次答對；因先前有誤，請再確認一次。" : ""}${esc(current.explanation)}${current.sourceRefs?.length ? `<small>依據：${current.sourceRefs.map(esc).join("、")}</small>` : ""}</div>`
        : (showExplain ? `<div class="quiz-explain">還不對。回到原句想一想：這個詞在句中的實際功能與搭配是什麼？</div>` : "")}
    </div>
  </div>`;
}

function recordLearning(interactionKey, data = {}, options = {}) {
  if (!state.current?.id) return Promise.resolve({ ok: false, reason: "no-lesson" });
  const pending = window.YwLearningEvidence?.record?.(interactionKey, state.current.id, data, options);
  return pending
    ? pending.catch(() => ({ ok: false, reason: "unavailable" }))
    : Promise.resolve({ ok: false, reason: "identity-unavailable" });
}

async function recordVocabAttempt(itemId, selectedIndex, lessonId = state.current?.id) {
  if (!lessonId) return { ok: false, reason: "no-lesson" };
  try {
    const response = await fetch("/api/reading/vocab-attempt", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        lessonId,
        itemId,
        selectedIndex,
        clientMutationId: window.YwLearningEvidence?.mutationId?.("vocabAnswer", lessonId)
          || `yw:${lessonId}:vocabAnswer:${crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`}`.slice(0, 100),
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.ok !== true) {
      return { ok: false, reason: response.status === 401 ? "anonymous" : payload.error || `http-${response.status}` };
    }
    return payload;
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}

function renderWordCreation(lesson, progress) {
  const value = progress.wordCreation && typeof progress.wordCreation === "object" ? progress.wordCreation : {};
  const mode = modeFor(lesson);
  const ending = mode === "poetry" ? "三行短詩" : mode === "drama" ? "三句對白" : mode === "fiction" ? "三句微型敘事" : "三句話";
  const body = `<p class="word-creation-prompt">選一個剛疏通的詞，用它寫${ending}。</p><input data-field="wordCreation.word" value="${esc(value.word || "")}" aria-label="本文新學到的一個字詞"><textarea data-field="wordCreation.creation" rows="5" aria-label="用這個字詞寫${ending}">${esc(value.creation || "")}</textarea>`;
  return authorDialogue(lesson, body, interactionResult(progress, "wordCreation"), `<button class="check-action" type="button" data-ai-check="wordCreation">核對</button>`);
}

function wadangMark(label) {
  return `<span class="stage-wadang" aria-hidden="true"><svg viewBox="0 0 48 48" focusable="false"><circle cx="24" cy="24" r="21"></circle><path d="M24 5v38M5 24h38M10.6 10.6l26.8 26.8M37.4 10.6 10.6 37.4"></path><circle cx="24" cy="24" r="8"></circle></svg><b>${esc(label)}</b></span>`;
}

function interestLabel(value) {
  const rating = clamp(Number(value) || 0, 0, 100);
  if (rating < 20) return "枯燥乏味";
  if (rating < 40) return "尚未入味";
  if (rating < 60) return "差強人意";
  if (rating < 80) return "漸入佳境";
  return rating < 96 ? "很有意思" : "拍案叫絕";
}

function renderReferenceAnswer(value) {
  if (Array.isArray(value)) {
    return `<ol>${value.map((entry) => `<li>${typeof entry === "object" ? renderReferenceAnswer(entry) : esc(entry)}</li>`).join("")}</ol>`;
  }
  if (value && typeof value === "object") {
    return `<dl>${Object.entries(value).map(([key, entry]) => `<dt>${esc(key)}</dt><dd>${renderReferenceAnswer(entry)}</dd>`).join("")}</dl>`;
  }
  return `<p>${esc(value || "本題須先人工複核，暫不提供唯一答案。")}</p>`;
}

function renderStudyGuideAssessment(record) {
  const assessment = record?.assessment;
  if (!assessment) {
    if (record?.submitting) return `<p class="study-guide-sync pending" role="status">正在進行來源端評閱…</p>`;
    if (record?.pendingSync) return `<p class="study-guide-sync pending" role="status">參考答案已顯示；本次評閱尚未同步，恢復登入或連線後請重試。</p>`;
    return "";
  }
  const passed = record.completed === true;
  return `<section class="study-guide-assessment ${passed ? "passed" : "needs-revision"}" aria-label="本次形成性評閱">
    <header><strong>${passed ? "本次達標" : "尚需修訂"}</strong><b>${Number(assessment.score) || 0} / 100</b></header>
    <p>${esc(assessment.verdict || "")}</p>
    ${assessment.strength ? `<dl><dt>已做到</dt><dd>${esc(assessment.strength)}</dd></dl>` : ""}
    ${assessment.gap ? `<dl><dt>關鍵缺口</dt><dd>${esc(assessment.gap)}</dd></dl>` : ""}
    ${assessment.nextQuestion ? `<dl><dt>重答提示</dt><dd>${esc(assessment.nextQuestion)}</dd></dl>` : ""}
  </section>`;
}

function renderStudyGuideCards(lesson, competencyTags) {
  const items = studyGuideItemsFor(lesson, competencyTags);
  if (!items.length) return "";
  const active = items.filter((item) => item.activeForSelfTest);
  const held = items.filter((item) => !item.activeForSelfTest);
  const records = studyGuideProgress();
  const completed = active.filter((item) => studyGuideRecordMatches(item, records[item.itemKey])).length;
  const current = active.find((item) => !studyGuideRecordMatches(item, records[item.itemKey])) || null;
  const storedRecord = current ? (records[current.itemKey] || {}) : {};
  const record = current && storedRecord.semanticRevision && storedRecord.semanticRevision !== current.semanticRevision
    ? {}
    : storedRecord;
  return `<section class="study-guide-deck" aria-label="學案知能清算">
    <header><div><span>學案知能清算</span><strong>實詞 · 虛詞 · 句式 · 考辨</strong></div><b>${completed} / ${active.length}</b></header>
    ${current ? `<article class="study-guide-card" data-study-item="${esc(current.itemKey)}">
      <div class="study-guide-source"><span>PDF ${Number(current.pdfPage) || "—"}${current.printedPage ? ` · 印 ${Number(current.printedPage)}` : ""}</span><i>${esc(current.detailTag || current.competencyTag)}</i></div>
      <h4>${esc(current.prompt)}</h4>
      ${current.qualityNotes?.length ? `<p class="study-guide-quality-notes"><strong>核對說明</strong>${esc(current.qualityNotes.join("；"))}</p>` : ""}
      ${record.revealed ? `<div class="study-guide-response-saved"><span>我的作答</span><p>${esc(record.response || "")}</p></div><div class="study-guide-answer"><b>${esc(current.answerLabel)}</b>${renderReferenceAnswer(current.referenceAnswer)}${current.explanation ? `<p class="study-guide-explanation">${esc(current.explanation)}</p>` : ""}${current.rubric ? `<div class="study-guide-rubric"><strong>核對標準</strong>${renderReferenceAnswer(current.rubric)}</div>` : ""}</div>
        ${renderStudyGuideAssessment(record)}
        ${record.completed ? "" : `<div class="study-guide-actions"><button type="button" data-study-retry="${esc(current.itemKey)}" ${record.submitting ? "disabled" : ""}>${record.pendingSync ? "返回作答並重試" : "依提示重答"}</button></div>`}`
        : `<form class="study-guide-response" data-study-response="${esc(current.itemKey)}"><label>先寫下你的答案<textarea name="response" rows="4" maxlength="2000" required>${esc(record.response || "")}</textarea></label><button class="study-guide-reveal" type="submit">提交作答並核對</button></form>`}
    </article>` : `<p class="study-guide-finished">本組 ${active.length} 個學案互動點已全部核對。</p>`}
    ${held.length ? `<div class="study-guide-held"><strong>${held.length} 項暫不計入本機步驟完成度；參考答案仍完整保留</strong>${held.map((item) => `<article><h5>${esc(item.prompt)}</h5><small>${esc((item.qualityNotes || []).join("；") || "主觀題或來源待複核")}</small><div class="study-guide-held-answer"><b>${esc(item.answerLabel)}</b>${renderReferenceAnswer(item.referenceAnswer)}${item.explanation ? `<p>${esc(item.explanation)}</p>` : ""}${item.rubric?.length ? `<div><strong>核對標準</strong>${renderReferenceAnswer(item.rubric)}</div>` : ""}</div></article>`).join("")}</div>` : ""}
  </section>`;
}

function appendFirstReadCorrections(body, lesson) {
  if (sourceModeFor(lesson) !== "classical") return body;
  const session = state.firstReads.get(lesson.id);
  return `${body}${renderStudyGuideCards(lesson, ["vocabulary", "syntax"])}${window.YwClassicalFirstRead?.renderCorrections?.(session) || ""}`;
}

function classicalRoundLocked(key, lesson, progress) {
  if (sourceModeFor(lesson) !== "classical" || key === "firstRead") return "";
  if (!checkpointDone(progress, "firstRead", lesson)) return "先完成無標點初讀，才會解鎖這一關。";
  const session = state.firstReads.get(lesson.id);
  if (!session?.annotatedReadCompleted) return "先讀完帶註釋正文，再進入詞級疏通。";
  if (["structure", "evaluation", "authorQuestion"].includes(key)
      && !checkpointDone(progress, "vocabulary", lesson)) {
    return "先完成紅藍訂正與詞級疏通，才會解鎖考辨與遷移。";
  }
  return "";
}

function renderInteractionBody(key, lesson, progress, blueprint) {
  const rawValue = progress[key];
  const value = rawValue && typeof rawValue === "object" ? rawValue : (rawValue === true ? { done: true } : {});
  if (key === "firstRead") {
    const session = state.firstReads.get(lesson.id);
    if (!session?.submitted) {
      return `<p class="first-read-round-status">在上方無標點正文完成至少 3 處紅筆標記，寫下第一直覺與初讀感知。</p>`;
    }
    return `<div class="first-read-round-status complete"><b>已提交初讀</b><span>${session.marks.length} 處疑難 · ${Math.round(Number(session.elapsedMs || 0) / 60000)} 分鐘</span><p>${esc(session.summary)}</p></div>`;
  }
  if (key === "context") {
    const words = String(value.words || "").split(/[，,、\s]+/).filter(Boolean).slice(0, 3);
    const body = `<div class="three-word-check"><div class="three-word-fields">${[0, 1, 2].map((index) => `<input data-context-word data-field="context.word${index + 1}" value="${esc(words[index] || "")}" maxlength="12" aria-label="第${index + 1}個詞" autocomplete="off">`).join("")}</div><span class="auto-check-status" data-auto-status="contextWords" aria-live="polite">${words.length === 3 ? "已記下" : `${words.length}/3`}</span></div>`;
    return authorDialogue(lesson, body, interactionResult(progress, "context"));
  }
  if (key === "vocabulary") {
    const bank = state.vocabBanks.get(lesson.id);
    if (bank) return appendFirstReadCorrections(renderVocabularyQuiz(lesson, progress, bank), lesson);
    if (bank === undefined && state.vocabBankLoading.has(lesson.id)) {
      return appendFirstReadCorrections(`<div class="vocabulary-step"><p class="vocabulary-empty">正在準備本課字詞題…</p></div>`, lesson);
    }
    const words = lessonVocabulary(lesson);
    const reviewed = new Set(value.reviewed || []);
    const completed = words.length === 0 || reviewed.size >= words.length;
    const current = words.find((item) => !reviewed.has(item.word));
    const percent = words.length ? Math.round(reviewed.size / words.length * 100) : 0;
    return appendFirstReadCorrections(`<div class="vocabulary-step" style="--vocabulary-progress:${percent}%">
      <div class="vocabulary-progress" aria-label="詞級疏通 ${reviewed.size} / ${words.length}"><span></span><b>${reviewed.size} / ${words.length}</b></div>
      ${completed ? (words.length ? `<p class="vocabulary-complete">已逐詞核對。</p>` : `<p class="vocabulary-empty">正文沒有獨立註詞。</p>`) : `<button type="button" data-vocabulary="${esc(current.word)}" data-note="${esc(current.note)}"><span>下一詞</span><strong>${esc(current.word)}</strong><em>查</em></button>`}
    </div>${completed && sourceModeFor(lesson) === "poetry" ? renderWordCreation(lesson, progress) : ""}`, lesson);
  }
  if (key === "read") return `<label class="read-check"><input type="checkbox" data-read-check ${value.checked || value.done ? "checked" : ""}><span>我已完成一次不中斷的正文通讀</span></label>`;
  if (key === "authorQuestion") return authorDialogue(lesson, `<textarea data-field="authorQuestion.answer" rows="4" aria-label="你想問作者的問題" placeholder="你最想我的問題是什麼，你問，我答。">${esc(value.answer || "")}</textarea>`, interactionResult(progress, key), `<button class="check-action" type="button" data-ai-check="authorQuestion">問</button>`);
  if (key === "revision") return authorDialogue(lesson, `<div class="revision-row"><input data-field="revision.original" value="${esc(value.original || "")}" aria-label="原文"><select data-field="revision.action" aria-label="增刪調"><option ${value.action === "調" ? "selected" : ""}>調</option><option ${value.action === "增" ? "selected" : ""}>增</option><option ${value.action === "刪" ? "selected" : ""}>刪</option></select><input data-field="revision.revised" value="${esc(value.revised || "")}" aria-label="改文"></div><textarea data-field="revision.reason" rows="4" aria-label="改動理由" placeholder="請說明如何修改的緣由">${esc(value.reason || "")}</textarea>`, interactionResult(progress, key), `<button class="check-action" type="button" data-ai-check="revision">核對</button>`);
  if (key === "structure") return `${authorDialogue(lesson, `<p class="structure-focus">${esc(blueprint.structureFocus)}</p><textarea data-field="structure.reason" rows="4" aria-label="回答作者的章法問題">${esc(value.reason || "")}</textarea>`, interactionResult(progress, key), `<button class="check-action" type="button" data-ai-check="structure">回應</button>`)}${sourceModeFor(lesson) === "classical" ? renderStudyGuideCards(lesson, ["comprehension"]) : ""}`;
  if (key === "evaluation") {
    const rating = Number.isFinite(Number(value.rating)) ? clamp(Number(value.rating), 0, 100) : 50;
    return `<div class="interest-rating" style="--rating:${rating}%">
      <div class="interest-rating-head"><span>本篇有意思</span><output data-interest-output>${rating}% · ${esc(interestLabel(rating))}</output></div>
      <input type="range" min="0" max="100" step="1" value="${rating}" data-interest-slider aria-label="本篇有意思程度，0 到 100">
      <div class="interest-rating-scale" aria-hidden="true"><span>枯燥乏味</span><span>差強人意</span><span>拍案叫絕</span></div>
      <span class="auto-save-status" aria-live="polite">${value.synced ? "已同步" : value.done ? "本機已存／尚未同步" : "拖動後自動保存"}</span>
    </div>`;
  }
  return "";
}

function renderCheckStage(lesson) {
  const progress = lessonProgress();
  const blueprint = state.blueprints.get(blueprintKey(lesson)) || blueprintFallback(lesson);
  const track = trackFor(lesson);
  const anonymousNotice = progressOwnerScope === ANONYMOUS_UI_SCOPE
    ? `<aside class="anonymous-learning-notice" role="note"><strong>目前是試做模式</strong><span>你仍可取得核對分數與修改提示，但本次不記入完成度，也不進入 User Center 的 A–F 評價。</span><a href="${esc(userCenterLoginUrl())}" target="_blank" rel="noopener noreferrer">登入後正式學習</a></aside>`
    : "";
  els.checkStage.innerHTML = anonymousNotice + track.map(([key, label, _detail, weight], index) => {
    const locked = classicalRoundLocked(key, lesson, progress);
    return `
    <section class="check-round ${checkpointDone(progress, key) ? "complete" : ""} ${locked ? "locked" : ""}" data-round="${key}" ${locked ? "aria-disabled=\"true\"" : ""}>
      <header>${wadangMark(STAGE_MARKS[index] || index + 1)}<h3>${esc(label)}</h3><b>${checkpointDone(progress, key) ? "本課完成" : `本課 ${weight}%`}</b></header>
      ${locked ? `<p class="round-lock"><span aria-hidden="true">鎖</span>${esc(locked)}</p>` : renderInteractionBody(key, lesson, progress, blueprint)}
    </section>
  `; }).join("");
  bindCheckStage();
  void ensureBlueprint(lesson);
  if (lessonHasVocabulary(lesson)) void ensureVocabBank(lesson);
}

function matrixItemsFor(lesson) {
  const mode = modeFor(lesson);
  const title = lessonTitle(lesson);
  const taxonomy = taxonomyFor(lesson);
  const items = [];
  const linkedAuthor = taxonomy.authors.find((author) => author.url);
  if (linkedAuthor) items.push({ label: "知人論世", title: `沿${linkedAuthor.name}的關係繼續讀`, href: linkedAuthor.url, meta: "群賢星圖", kind: "source" });
  if (taxonomy.sourceBooks.length) items.push({ label: "書目互文", title: `查看《${taxonomy.sourceBooks[0]}》與五冊篇目的連線`, href: `books.html?q=${encodeURIComponent(taxonomy.sourceBooks[0])}`, meta: "書目星圖", kind: "source" });
  const add = (label, text, href, meta) => items.push({ label, title: text, href, meta, kind: "ability" });
  if (mode === "classical") {
    add("文言遷移", "把本課實詞、句法與章法帶入高考文言", "https://gwyw.bdfz.net/", "AI 文言");
    add("字詞闖關", "把剛核對的古漢語字詞放進新的語境", "https://wygame.bdfz.net/", "AI 字詞");
    add("背誦默寫", "對需要積累的名句做誦讀、接龍與默寫", "https://recite.bdfz.net/", "高考背誦");
  } else if (mode === "poetry") {
    add("詩詞鑑賞", "把意象、聲律與鍊字判斷遷移到陌生詩歌", "https://shi.bdfz.net/", "AI 詩詞");
    add("聲音重讀", "換用耳朵核對節奏、停連與情感變奏", "https://voice.bdfz.net/", "人籟");
    add("默寫鞏固", "從理解走到可提取的古詩文積累", "https://mf.bdfz.net/", "高考默寫");
  } else if (["fiction", "drama"].includes(mode)) {
    add("敘事遷移", "把人物、細節與結尾判斷帶進高考散文", "https://gksw.bdfz.net/", "AI 散文");
    add("改寫成篇", "把本課的一字之改擴展為完整敘事寫作", "https://zw.bdfz.net/", "AI 作文");
    add("共讀書架", "從單篇人物走向整本書與共同閱讀", "https://coread.bdfz.net/", "披覽 · 共讀");
  } else if (["journalism", "science"].includes(mode)) {
    add("材料遷移", "把來源、圖表、證據與結論放進非連續文本", "https://flx.bdfz.net/", "AI 非連");
    add("真題核驗", "在高考真題中追蹤同一類信息處理能力", "https://gks.bdfz.net/", "高考真題");
    add("術語辨析", "核對本課使用的概念與語文術語", "https://sy.bdfz.net/", "語文術語圖譜");
  } else {
    add("語用遷移", "把概念、句式與語氣選擇轉成語用判斷", "https://yyjc.bdfz.net/", "AI 語用");
    add("觀點成篇", "把本課評價發展成有證據的議論文字", "https://zw.bdfz.net/", "AI 作文");
    add("真題坐標", "回到完整真題庫確認能力在高考中的位置", "https://gk.bdfz.net/", "AI 高考");
  }
  if (/論語|孔子|子路|顏淵/.test(title)) {
    add("論語互證", "讓本課語句與《論語》章句互相發問", "https://kz.bdfz.net/", "AI 論語");
    add("義戰辨章", "用章句辨析檢驗你的價值判斷", "https://ly.bdfz.net/", "義戰論語");
  }
  return items.slice(0, 9);
}

function renderMatrix(lesson) {
  const progress = lessonProgress(lesson.id);
  if (sourceModeFor(lesson) === "classical" && !checkpointDone(progress, "vocabulary", lesson)) {
    els.matrixLinks.innerHTML = `<section class="matrix-locked"><span aria-hidden="true">鎖</span><h3>關卡三 · 考辨與遷移</h3><p>完成初讀疑難訂正與詞級疏通後，能力遷移會在此直接展開。</p></section>`;
    return;
  }
  const examPrompts = primaryContentParts(lesson).examPrompts;
  els.matrixLinks.innerHTML = `
    ${examPrompts.length ? `
      <section class="exam-anchor">
        <header><span>本課真題錨點</span><strong>${examPrompts.length} 道／組</strong></header>
        ${examPrompts.map((prompt) => `<p>${esc(prompt)}</p>`).join("")}
        <a class="exam-more" href="https://gk.bdfz.net/" target="_blank" rel="noreferrer">進入完整高考真題庫 ↗</a>
      </section>
    ` : ""}
    <div class="matrix-route expanded">
    ${matrixItemsFor(lesson).map((item, index) => {
      const plan = resourcePreviewPlan(item);
      return `
    <article class="matrix-preview matrix-${esc(item.kind)}">
      <header><span>${String(index + 1).padStart(2, "0")} · ${esc(item.label)}</span><small>${esc(item.meta)}</small></header>
      <strong>${esc(item.title)}</strong>
      <div class="matrix-preview-frame" data-preview-src="${esc(item.href)}">${previewPlaceholder(plan)}</div>
      <p class="preview-state-note" data-preview-note>${esc(plan.reason)}</p>
      ${previewFallback(plan)}
    </article>
    `; }).join("")}</div>
  `;
  activateExpandedPreviews(els.matrixLinks);
}

function activateExpandedPreviews(root) {
  const frames = $$('[data-preview-src]', root);
  const load = (host) => {
    if (host.dataset.loaded === "1") return;
    host.dataset.loaded = "1";
    const source = host.dataset.previewSrc;
    const title = host.closest("article")?.querySelector("strong")?.textContent || "能力遷移";
    mountResourcePreview(host, resourcePreviewPlan({ href: source }), title);
  };
  frames.forEach(load);
}

function renderMastery() {
  const progress = lessonProgress();
  const percent = progressPercent(progress);
  if (els.masteryLabel) {
    els.masteryLabel.textContent = progressOwnerScope === ANONYMOUS_UI_SCOPE
      ? "本機試做 · 未記錄"
      : "本機步驟完成度";
  }
  els.masterySpectrum.style.setProperty("--mastery", `${percent}%`);
  els.masteryValue.textContent = percent;
  els.checkpointList.innerHTML = trackFor().map(([key, label], index) => `
    <li data-checkpoint="${key}" class="${checkpointDone(progress, key) ? "complete" : ""}"><button type="button">${wadangMark(STAGE_MARKS[index] || index + 1)}<strong>${esc(label)}</strong><em>${checkpointDone(progress, key) ? "已見" : "未見"}</em></button></li>
  `).join("");
}

function resetLessonChat() {
  if (!els.lessonChatFrame || !els.lessonChatPlaceholder) return;
  if (document.activeElement === els.lessonChatFrame) els.lessonChatFrame.blur();
  els.lessonChatFrame.hidden = true;
  els.lessonChatPlaceholder.hidden = false;
  if (els.lessonChatFrame.src !== "about:blank") els.lessonChatFrame.src = "about:blank";
}

function renderLessonChat(lesson) {
  if (
    !els.lessonChatFrame
    || !els.lessonChatTitle
    || !els.lessonChatSection
    || !els.lessonChatPlaceholder
    || !els.lessonChatLoad
  ) return;
  const firstRead = state.firstReads.get(lesson.id);
  const locked = sourceModeFor(lesson) === "classical" && firstRead && !firstRead.submitted;
  els.lessonChatSection.hidden = locked;
  resetLessonChat();
  if (locked) {
    return;
  }
  const title = lessonTitle(lesson);
  els.lessonChatTitle.textContent = `《${title}》同讀`;
  els.lessonChatFrame.title = `《${title}》實時聊天`;
  els.lessonChatLoad.dataset.lessonId = lesson.id;
}

function syncProgress({ event = false } = {}) {
  saveStoredProgress();
  if (!state.current || !state.manifest) return;
  renderMastery();
  renderLessonIndex();
  renderMatrix(state.current);
  if (!state.current) return;
  const percent = progressPercent();
  const send = async () => {
    const progress = lessonProgress();
    if (event && percent === 100 && !progress.completionEventSent) {
      const evidence = await recordLearning("lessonCompleted", {
        checkpointCount: trackFor().filter(([key]) => checkpointDone(progress, key)).length,
        checkpointTotal: trackFor().length,
      });
      progress.completionEventSent = evidence?.ok === true;
      saveStoredProgress();
    }
  };
  void send();
}

function renderLesson(lesson) {
  els.title.textContent = lessonTitle(lesson);
  els.topbarContext.textContent = `${lesson.blockTitle || "高中語文"} · ${lessonTitle(lesson)}`;
  els.mastheadVolume.textContent = lesson.blockTitle || "高中語文";
  const block = state.manifest.blocks.find((item) => item.id === (lesson.blockId || state.blockId));
  const readingLessons = (block?.lessons || []).filter((item) => !isUnitHeading(item) && !isUnitTask(item) && !isRetiredMirror(item));
  const position = readingLessons.findIndex((item) => item.id === lesson.id);
  els.mastheadPosition.textContent = position >= 0 ? `第 ${String(position + 1).padStart(2, "0")} 篇` : (isUnitTask(lesson) ? "研習任務" : "單元導讀");
  document.title = `${lessonTitle(lesson)} · 課文`;
  const firstRead = state.firstReads.get(lesson.id);
  const firstReadLocked = Boolean(sourceModeFor(lesson) === "classical" && firstRead && !firstRead.submitted);
  els.body.classList.toggle("first-read-locked", firstReadLocked);
  els.pageOpen.disabled = firstReadLocked;
  els.resourcesOpen.disabled = firstReadLocked;
  els.pageOpen.title = firstReadLocked ? "完成無標點初讀後解鎖" : "";
  els.resourcesOpen.title = firstReadLocked ? "完成無標點初讀後解鎖" : "";
  renderOrientation(lesson);
  renderText(lesson);
  renderMaterials(lesson);
  renderLessonMedia(lesson);
  renderCheckStage(lesson);
  renderLessonChat(lesson);
  renderMatrix(lesson);
  renderMastery();
  preparePages(lesson);
  renderLessonIndex();
  void ensureBlueprint(lesson);
  els.body.classList.remove("lesson-enter");
  requestAnimationFrame(() => {
    fitLessonTitle();
    els.body.classList.add("lesson-enter");
  });
}

function setToolsOpen(open) {
  els.body.classList.toggle("tools-open", open);
  els.mobileToolsToggle.setAttribute("aria-expanded", String(open));
  els.mobileToolsToggle.setAttribute("aria-label", open ? "關閉篇目工具" : "打開篇目工具");
  if (matchMedia("(max-width: 900px)").matches) els.topbarActions.inert = !open;
  else els.topbarActions.inert = false;
}

function fitLessonTitle() {
  const title = els.title;
  if (!title) return;
  title.style.removeProperty("font-size");
  if (matchMedia("(max-width: 620px)").matches) {
    let size = parseFloat(getComputedStyle(title).fontSize) || 24;
    let lineHeight = parseFloat(getComputedStyle(title).lineHeight) || size * 1.05;
    while (title.scrollHeight > lineHeight * 2 + 1 && size > 18) {
      size = Math.max(18, size - 0.5);
      title.style.fontSize = `${size}px`;
      lineHeight = parseFloat(getComputedStyle(title).lineHeight) || size * 1.05;
    }
    return;
  }
  const available = title.parentElement?.clientWidth || title.clientWidth;
  let size = parseFloat(getComputedStyle(title).fontSize) || 92;
  while (title.scrollWidth > available && size > 16) {
    size -= 1;
    title.style.fontSize = `${size}px`;
  }
}

function renderReaderLoadFailure(id) {
  state.current = null;
  els.title.textContent = "課文暫時無法載入";
  els.orientation.textContent = "請稍後重試。";
  els.textFlow.innerHTML = `
    <div class="empty-state" role="status">
      <p>課文暫時無法顯示。</p>
      <button type="button" data-reader-retry="${esc(id)}">重試</button>
    </div>`;
  els.textFlow.querySelector("[data-reader-retry]")?.addEventListener("click", () => {
    void showLesson(id, { push: false });
  }, { once: true });
}

let lessonToken = 0;
async function showLesson(
  id,
  {
    push = true,
    recordEvidence = true,
    syncSharedState = true,
    stateGuard = null,
  } = {},
) {
  const token = ++lessonToken;
  try {
    const meta = state.manifest.lessons.find((lesson) => lesson.id === id);
    if (!meta) throw new Error("找不到課文");
    let lesson = state.lessons.get(id);
    let shouldCache = false;
    if (!lesson) {
      lesson = await fetchJson(meta.dataUrl);
      lesson.readerDocument = await loadReaderDocument(id);
      shouldCache = true;
    }
    if (sourceModeFor(lesson) === "classical" && !state.firstReads.has(id)) {
      const firstRead = await window.YwClassicalFirstRead.load(id);
      if (!firstRead) throw new Error("無標點初讀正文缺失");
      state.firstReads.set(id, firstRead);
      const progress = lessonProgress(id);
      progress.firstRead = {
        ...(progress.firstRead || {}),
        done: firstRead.submitted,
        markCount: firstRead.marks.length,
        resolvedCount: firstRead.marks.filter((mark) => mark.resolutionStatus === "resolved").length,
        summary: firstRead.summary,
        textVersionId: firstRead.asset.textVersionId,
      };
      saveStoredProgress();
    }
    if (token !== lessonToken) return;
    if (stateGuard && !await stateGuard()) return;
    state.current = lesson;
    state.activeAuthorId = taxonomyFor(lesson).authors?.[0]?.id || "";
    state.blockId = lesson.blockId || meta.blockId || state.blockId;
    renderBooks();
    renderLesson(lesson);
    if (shouldCache) state.lessons.set(id, lesson);
    if (recordEvidence) void recordLearning("lessonOpened");
    if (syncSharedState) queueSharedReadingPosition(lesson);
    if (push) history.replaceState(null, "", `#${lesson.id}`);
    if (matchMedia("(max-width: 900px)").matches) closeAtlas();
    scrollTo({ top: 0, behavior: "auto" });
  } catch {
    if (token !== lessonToken) return;
    state.lessons.delete(id);
    state.readerIndex = null;
    renderReaderLoadFailure(id);
    toast("無法載入這篇課文");
  }
}

function fieldValue(path) {
  return els.checkStage.querySelector(`[data-field="${path}"]`)?.value.trim() || "";
}

function interactionInput(key) {
  if (key === "contextWords") return { words: [1, 2, 3].map((index) => fieldValue(`context.word${index}`)).filter(Boolean).join("、") };
  if (key === "authorQuestion") return { answer: fieldValue("authorQuestion.answer") };
  if (key === "revision") return { original: fieldValue("revision.original"), action: fieldValue("revision.action"), revised: fieldValue("revision.revised"), reason: fieldValue("revision.reason") };
  if (key === "structure") return { reason: fieldValue("structure.reason") };
  if (key === "wordCreation") return { word: fieldValue("wordCreation.word"), creation: fieldValue("wordCreation.creation") };
  return {};
}

function interactionInputLength(input) {
  return Object.values(input).join("").replace(/\s+/g, "").length;
}

function interactionEvidenceDecision(status, score) {
  const normalized = String(status || "").trim();
  if (normalized === "anonymous") {
    return { accepted: true, recorded: false, completed: false, evidenceStatus: "anonymous" };
  }
  if (normalized === "already_recorded_ineligible" || normalized.endsWith("_ineligible")) {
    return { accepted: true, recorded: true, completed: false, evidenceStatus: "ineligible" };
  }
  if (["recorded", "enqueued", "pending", "local_only", "already_recorded", "delivered"].includes(normalized)) {
    return { accepted: true, recorded: true, completed: Number(score) >= 60, evidenceStatus: "recorded" };
  }
  return { accepted: false, recorded: false, completed: false, evidenceStatus: "unavailable" };
}

async function submitInteraction(key, button = null, { silent = false } = {}) {
  const input = interactionInput(key);
  const compactLength = interactionInputLength(input);
  const minimum = key === "contextWords" ? 3 : key === "authorQuestion" ? 12 : 24;
  if (compactLength < minimum) {
    if (!silent) toast(key === "contextWords" ? "請輸入三個詞" : key === "authorQuestion" ? "問題需要更具體，至少 12 字" : "先寫完整");
    return;
  }
  if (key === "contextWords" && input.words.split(/[，,、\s]+/).filter(Boolean).length !== 3) { if (!silent) toast("請恰好輸入三個詞"); return; }
  const autoStatus = els.checkStage.querySelector(`[data-auto-status="${key}"]`);
  if (button) {
    button.disabled = true;
    button.textContent = "核對中";
  }
  if (autoStatus) autoStatus.textContent = "核對中";
  try {
    const clientMutationId = window.YwLearningEvidence?.mutationId?.(key, state.current.id);
    const response = await fetch("/api/interaction-check", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        lessonId: state.current.id,
        lessonTitle: lessonTitle(state.current),
        blockTitle: state.current.blockTitle,
        mode: modeFor(state.current),
        genres: genreNodesFor(state.current).map((genre) => genre.label),
        authors: [authorNameFor(state.current)],
        interaction: key,
        blueprint: state.blueprints.get(blueprintKey(state.current)) || blueprintFallback(state.current),
        excerpt: String(primaryPost(state.current)?.plain_text || state.current.excerpt || "").slice(0, 4200),
        input,
        clientMutationId,
      }),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || `評估失敗 ${response.status}`);
    const result = payload.assessment || {};
    const progressKey = key === "contextWords" ? "context" : key;
    const score = Number(result.score || 0);
    const evidence = interactionEvidenceDecision(payload.evidence?.status, score);
    if (!evidence.accepted) throw new Error("學習證據回執無效，未計入完成度");
    lessonProgress()[progressKey] = {
      ...lessonProgress()[progressKey],
      ...input,
      done: evidence.completed,
      score,
      result,
      evidenceStatus: evidence.evidenceStatus,
    };
    if (key === "wordCreation" && !lessonVocabulary(state.current).length) {
      lessonProgress().vocabulary = {
        ...(lessonProgress().vocabulary || {}),
        done: evidence.completed,
        reviewed: [],
        evidenceStatus: evidence.evidenceStatus,
      };
    }
    if (key === "contextWords") void saveReadingSubmission(input, result);
    if (!silent) {
      const label = trackFor().find((item) => item[0] === progressKey)?.[1] || "互動";
      if (evidence.evidenceStatus === "anonymous") toast(`${score} 分 · 未登入，本次未記錄`);
      else if (evidence.evidenceStatus === "ineligible") toast(`${label} · ${score} 分，已記錄但不計入本次完成`);
      else toast(`${label} · ${score} 分，已記錄`);
    }
    syncProgress({ event: true });
    renderCheckStage(state.current);
  } catch (error) {
    if (!silent) toast(error.message || "暫時無法完成評估");
    if (button) {
      button.disabled = false;
      button.textContent = "重試";
    }
    if (autoStatus) autoStatus.textContent = "未核對";
  }
}

async function saveReadingSubmission(input, result) {
  try {
    const words = String(input.words || "").split(/[，,、\s]+/).filter(Boolean).slice(0, 3);
    if (words.length !== 3 || !state.current) return;
    await fetch("/api/reading/submission", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        lessonId: state.current.id,
        words,
        aiScore: Number(result?.score || 0),
        aiVerdict: String(result?.verdict || ""),
      }),
    });
  } catch { /* 未登入或離線時僅保留本地進度，星圖等待下次有效提交 */ }
}

async function saveEvaluation(explicitRating = null, { quiet = false } = {}) {
  const candidate = explicitRating === null || explicitRating === undefined
    ? (els.checkStage.querySelector("[data-interest-slider]")?.value ?? lessonProgress().evaluation?.rating)
    : explicitRating;
  const rating = Number(candidate);
  const reason = fieldValue("evaluation.reason");
  const lessonId = state.current?.id;
  if (!lessonId || !Number.isFinite(rating) || rating < 0 || rating > 100) {
    return { ok: false, synced: false, savedLocal: false, rating: null, reason: "invalid-evaluation" };
  }
  const ownerScope = progressOwnerScope;
  const localEvaluation = { rating, reason, done: true, synced: false };
  lessonProgress(lessonId).evaluation = localEvaluation;
  syncProgress({ event: true });
  const evidence = await recordLearning("evaluation", { rating, reason: reason.slice(0, 300) });
  const synced = evidence?.ok === true;
  if (
    progressOwnerScope === ownerScope
    && state.progress[lessonId]?.evaluation === localEvaluation
  ) {
    localEvaluation.synced = synced;
    saveStoredProgress();
  }
  const result = {
    ok: synced,
    synced,
    savedLocal: Boolean(ownerScope),
    rating,
    status: Number(evidence?.status) || null,
    reason: evidence?.reason || (synced ? "synced" : "unavailable"),
  };
  if (!quiet) {
    toast(synced
      ? `有意思程度已同步為 ${rating}%`
      : result.savedLocal
        ? `有意思程度 ${rating}% 本機已存／尚未同步`
        : `有意思程度 ${rating}% 尚未同步；登入狀態未確認`);
  }
  return result;
}

function studyGuideMutationId(lessonId) {
  return window.YwLearningEvidence?.mutationId?.("studyGuideItemCompleted", lessonId)
    || `yw:${lessonId}:studyGuideItemCompleted:${crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`}`.slice(0, 100);
}

async function submitStudyGuideAttempt({ lessonId, itemKey, response, referenceRevealedAt, clientMutationId }) {
  try {
    const result = await fetch("/api/reading/study-guide-attempt", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ lessonId, itemKey, response, referenceRevealedAt, clientMutationId }),
    });
    const payload = await result.json().catch(() => ({}));
    if (!result.ok || payload.ok !== true) {
      return {
        ok: false,
        status: result.status,
        reason: payload.error || (result.status === 401 ? "anonymous" : `http-${result.status}`),
      };
    }
    return payload;
  } catch {
    return { ok: false, status: 0, reason: "unavailable" };
  }
}

function bindCheckStage() {
  const firstRead = state.firstReads.get(state.current?.id);
  if (firstRead) {
    window.YwClassicalFirstRead?.bindCorrections?.(els.checkStage, firstRead, {
      toast,
      onChange: () => {
        const resolvedCount = firstRead.marks.filter((mark) => mark.resolutionStatus === "resolved").length;
        lessonProgress().firstRead = {
          ...(lessonProgress().firstRead || {}),
          done: true,
          markCount: firstRead.marks.length,
          resolvedCount,
        };
        syncProgress({ event: true });
        renderCheckStage(state.current);
        if (resolvedCount === firstRead.marks.length) toast("初讀疑難已全部完成藍筆訂正");
      },
    });
  }
  $$('[data-study-response]', els.checkStage).forEach((form) => form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const response = String(new FormData(form).get("response") || "").trim();
    if (!response) {
      toast("請先寫下自己的答案，再看參考答案");
      return;
    }
    const lessonId = state.current?.id;
    const itemKey = form.dataset.studyResponse;
    const item = state.studyGuideLessons.get(lessonId)?.items?.find((entry) => entry.itemKey === itemKey);
    if (!lessonId || !item?.activeForSelfTest) {
      toast("本題已更新，請重新載入後再答");
      return;
    }
    const ownerScope = progressOwnerScope;
    const records = studyGuideProgress(lessonProgress(lessonId));
    const previous = records[itemKey] || {};
    const replayPending = previous.pendingSync === true
      && previous.response === response
      && previous.semanticRevision === item.semanticRevision
      && previous.clientMutationId
      && Number.isFinite(Date.parse(previous.referenceRevealedAt));
    const clientMutationId = replayPending ? previous.clientMutationId : studyGuideMutationId(lessonId);
    const referenceRevealedAt = replayPending ? previous.referenceRevealedAt : new Date().toISOString();
    const pendingRecord = {
      ...previous,
      semanticRevision: item.semanticRevision,
      response,
      revealed: true,
      referenceRevealedAt,
      clientMutationId,
      submitting: true,
      pendingSync: false,
      completed: false,
      assessment: replayPending ? previous.assessment : null,
    };
    records[itemKey] = pendingRecord;
    syncProgress();
    renderCheckStage(state.current);
    const result = await submitStudyGuideAttempt({
      lessonId,
      itemKey,
      response,
      referenceRevealedAt,
      clientMutationId,
    });
    if (progressOwnerScope !== ownerScope || records[itemKey]?.clientMutationId !== clientMutationId) return;
    const completed = result?.ok === true
      && result.passed === true
      && result.evidence?.eligibilityStatus === "eligible";
    records[itemKey] = {
      ...records[itemKey],
      submitting: false,
      pendingSync: result?.ok !== true,
      completed,
      assessment: result?.ok === true ? result.assessment : records[itemKey]?.assessment || null,
      evidence: result?.ok === true ? result.evidence : null,
      lastError: result?.ok === true ? "" : result?.reason || "unavailable",
      assessedAt: result?.ok === true ? new Date().toISOString() : null,
    };
    syncProgress({ event: true });
    if (state.current?.id === lessonId) renderCheckStage(state.current);
    if (completed) {
      toast(`本次達標 ${Number(result.assessment?.score) || 0} 分，已同步形成性掌握度`);
    } else if (result?.ok === true) {
      toast(`本次 ${Number(result.assessment?.score) || 0} 分，已記錄；請依提示重答`);
    } else {
      toast(result?.status === 401
        ? "參考答案已顯示；登入後可重試形成性評閱"
        : "參考答案已顯示；評閱尚未同步，稍後請重試");
    }
  }));
  $$('[data-study-retry]', els.checkStage).forEach((button) => button.addEventListener("click", () => {
    const records = studyGuideProgress();
    records[button.dataset.studyRetry] = {
      ...(records[button.dataset.studyRetry] || {}),
      revealed: false,
      submitting: false,
    };
    syncProgress();
    renderCheckStage(state.current);
  }));
  $$('[data-ai-check]', els.checkStage).forEach((button) => button.addEventListener("click", () => submitInteraction(button.dataset.aiCheck, button)));
  const contextWords = $$('[data-context-word]', els.checkStage);
  if (contextWords.length) contextWords.forEach((field) => field.addEventListener("input", () => {
    clearTimeout(submitInteraction.contextTimer);
    const parts = contextWords.map((item) => item.value.trim()).filter(Boolean);
    const words = parts.join("、");
    const status = els.checkStage.querySelector('[data-auto-status="contextWords"]');
    if (status) status.textContent = parts.length === 3 ? "待核對" : `${parts.length}/3`;
    if (parts.length !== 3) return;
    const saved = lessonProgress().context;
    if (saved?.words === words && saved?.result) {
      if (status) status.textContent = "已核對";
      return;
    }
    submitInteraction.contextTimer = setTimeout(() => void submitInteraction("contextWords", null, { silent: true }), 720);
  }));
  $$('[data-interest-slider]', els.checkStage).forEach((slider) => {
    const update = () => {
      const rating = clamp(Number(slider.value), 0, 100);
      const host = slider.closest(".interest-rating");
      host?.style.setProperty("--rating", `${rating}%`);
      const output = host?.querySelector("[data-interest-output]");
      if (output) output.textContent = `${rating}% · ${interestLabel(rating)}`;
      const status = host?.querySelector(".auto-save-status");
      if (status) status.textContent = "待保存";
    };
    slider.addEventListener("input", update);
    slider.addEventListener("change", () => {
      const rating = clamp(Number(slider.value), 0, 100);
      const status = slider.closest(".interest-rating")?.querySelector(".auto-save-status");
      if (status) status.textContent = `正在保存 ${rating}%…`;
      void saveEvaluation(rating, { quiet: true }).then((result) => {
        if (!status) return;
        status.textContent = result?.synced
          ? `已同步 ${rating}%`
          : result?.savedLocal
            ? "本機已存／尚未同步"
            : "尚未同步；登入狀態未確認";
      });
    });
  });
  $$('[data-quiz-option]', els.checkStage).forEach((button) => button.addEventListener("click", async () => {
    const lessonId = state.current?.id;
    const bank = state.vocabBanks.get(lessonId);
    const itemHost = button.closest("[data-quiz-item]");
    if (!lessonId || !bank || !itemHost) return;
    if (itemHost.dataset.submitting === "1") return;
    const item = bank.questions.find((entry) => entry.id === itemHost.dataset.quizItem);
    if (!item) return;
    const progress = lessonProgress(lessonId);
    const quiz = quizRecord(progress);
    const previous = quiz.answers[item.id] || { attempts: 0, correct: false, mastered: false };
    if (previous.correct) return;
    const pick = Number(button.dataset.quizOption);
    itemHost.dataset.submitting = "1";
    const optionButtons = $$('[data-quiz-option]', itemHost);
    optionButtons.forEach((option) => { option.disabled = true; });
    const formal = window.YwVocabProgress?.isFormalVocabularyQuestion?.(
      state.formalVocabResourceKeys,
      lessonId,
      item.id,
    ) === true;
    const result = formal
      ? await recordVocabAttempt(item.id, pick, lessonId)
      : { ok: true, localPractice: true };
    if (state.current?.id !== lessonId) return;
    const entry = formal
      ? window.YwVocabProgress?.applyServerAttempt?.(previous, result, pick)
      : window.YwVocabProgress?.applyLocalPracticeAttempt?.(
        previous,
        pick === item.answerIndex,
        pick,
      );
    if (!entry) {
      itemHost.dataset.submitting = "0";
      optionButtons.forEach((option) => { option.disabled = false; });
      toast(result?.reason === "anonymous" ? "請先登入，再完成字詞自測" : "本次答案尚未同步，請恢復連線後重試");
      return;
    }
    quiz.answers[item.id] = entry;
    quiz.cursorId = entry.correct
      ? window.YwVocabProgress?.nextCursor?.(bank.questions, quiz.answers)
        ?? bank.questions.find((question) => !quizItemState(quiz, question.id).correct)?.id
        ?? null
      : item.id;
    const solvedAll = bank.questions.every((question) => quizRecord(progress).answers[question.id]?.correct);
    progress.vocabulary = {
      ...(progress.vocabulary || {}),
      done: solvedAll,
      quiz: solvedAll,
    };
    if (solvedAll) {
      quiz.completionSent = Boolean(result.completionEvidence);
    }
    syncProgress({ event: true });
    if (!entry.correct) {
      renderCheckStage(state.current);
      return;
    }
    button.classList.add("correct");
    itemHost.classList.add("quiz-advancing");
    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
    setTimeout(() => {
      const canAdvance = window.YwVocabProgress?.canAdvanceScheduledLesson?.(
        state.current?.id,
        lessonId,
      ) ?? state.current?.id === lessonId;
      if (!canAdvance) return;
      renderCheckStage(state.current);
      const round = els.checkStage.querySelector('[data-round="vocabulary"]');
      round?.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "center" });
    }, reducedMotion ? 0 : 220);
  }));
  $$('[data-quiz-lookup]', els.checkStage).forEach((button) => button.addEventListener("click", () => {
    openLexicon(button.dataset.quizLookup);
  }));
  $$('[data-vocabulary]', els.checkStage).forEach((button) => button.addEventListener("click", () => {
    const progress = lessonProgress();
    progress.vocabulary ||= { reviewed: [], done: false };
    const reviewed = new Set(progress.vocabulary.reviewed || []);
    reviewed.add(button.dataset.vocabulary);
    progress.vocabulary.reviewed = [...reviewed];
    const total = lessonVocabulary(state.current).length;
    progress.vocabulary.done = total > 0 && reviewed.size >= total;
    syncProgress();
    openLexicon(button.dataset.vocabulary);
    renderCheckStage(state.current);
  }));
  $$('[data-read-check]', els.checkStage).forEach((checkbox) => checkbox.addEventListener("change", () => {
    const previous = lessonProgress().read && typeof lessonProgress().read === "object" ? lessonProgress().read : {};
    lessonProgress().read = { ...previous, checked: checkbox.checked, done: checkbox.checked };
    syncProgress();
    if (checkbox.checked) void recordLearning("readAcknowledged", { threshold: "manual_confirmation" });
    renderCheckStage(state.current);
    if (checkbox.checked) toast("已記下");
  }));
  const reason = els.checkStage.querySelector("[data-evaluation-reason]");
  if (reason) {
    reason.addEventListener("input", () => {
      clearTimeout(saveEvaluation.timer);
      saveEvaluation.timer = setTimeout(() => void saveEvaluation(null, { quiet: true }), 700);
    });
    reason.addEventListener("blur", () => void saveEvaluation(null, { quiet: true }));
  }
}

function openLexicon(text) {
  const clean = String(text || "").replace(/\s+/g, " ").trim().slice(0, 80);
  if (!clean) return;
  state.selectedText = clean;
  state.lexiconReturnFocus = document.activeElement;
  els.selectionWord.textContent = clean;
  els.lexiconDock.classList.add("open");
  els.body.classList.add("lexicon-open");
  els.lexiconDock.setAttribute("aria-hidden", "false");
  updateLexiconFrame();
  requestAnimationFrame(() => els.lexiconClose.focus());
  void recordLearning("vocabularyLookup", {
    lookupKind: state.lexicon,
    termLength: [...clean].length,
  });
}

function closeLexicon() {
  window.getSelection()?.removeAllRanges();
  els.lexiconDock.classList.remove("open");
  els.body.classList.remove("lexicon-open");
  els.lexiconDock.setAttribute("aria-hidden", "true");
  if (state.lexiconReturnFocus?.focus) state.lexiconReturnFocus.focus({ preventScroll: true });
  state.lexiconReturnFocus = null;
  setTimeout(() => { if (!els.lexiconDock.classList.contains("open")) els.lexiconFrame.src = "about:blank"; }, 260);
}

function updateLexiconFrame() {
  const word = state.selectedText;
  const firstHan = (word.match(/[\u3400-\u9fff]/) || [word.charAt(0)])[0];
  const url = state.lexicon === "dict"
    ? `https://sun.bdfz.net/dict.html?q=${encodeURIComponent(word.slice(0, 16))}`
    : `https://zi.tools/zi/${encodeURIComponent(firstHan)}`;
  els.lexiconFrame.src = url;
  els.lexiconFrame.title = state.lexicon === "dict" ? `辭典：${word}` : `字統：${firstHan}`;
  els.moeExternal.href = `https://dict.revised.moe.edu.tw/search.jsp?md=1&word=${encodeURIComponent(word.slice(0, 20))}`;
}

function preparePages(lesson) {
  const direct = lesson.textbook?.pageImages || [];
  const context = (lesson.textbook?.contextPageImages || []).filter((page) => page.matched);
  state.pages = direct.length ? direct : context;
  state.pageIndex = 0;
  const firstRead = state.firstReads.get(lesson.id);
  const firstReadLocked = Boolean(sourceModeFor(lesson) === "classical" && firstRead && !firstRead.submitted);
  els.pageOpen.disabled = firstReadLocked || !state.pages.length;
}

function showPage(index) {
  if (!state.pages.length) return;
  state.pageIndex = clamp(index, 0, state.pages.length - 1);
  const page = state.pages[state.pageIndex];
  els.pageImage.src = page.src;
  els.pageImage.alt = `${lessonTitle(state.current)} ${page.label}`;
  els.pageCaption.textContent = `${state.current.textbook?.bookTitle || state.current.blockTitle} · ${page.label} · ${state.pageIndex + 1}/${state.pages.length}`;
  els.pagePrev.disabled = state.pageIndex === 0;
  els.pageNext.disabled = state.pageIndex === state.pages.length - 1;
  $$('.page-strip button', els.pageStrip).forEach((button, buttonIndex) => button.classList.toggle("active", buttonIndex === state.pageIndex));
}

function openPages(index = 0) {
  const firstRead = state.firstReads.get(state.current?.id);
  if (sourceModeFor(state.current) === "classical" && firstRead && !firstRead.submitted) {
    toast("完成無標點初讀後再打開教材原圖");
    return;
  }
  if (!state.pages.length) {
    toast("本課尚未匹配到教材原圖");
    return;
  }
  els.pageDialogTitle.textContent = lessonTitle(state.current);
  els.pageStrip.innerHTML = state.pages.map((page, pageIndex) => `
    <button type="button" data-page-index="${pageIndex}"><img src="${esc(page.src)}" alt="${esc(page.label)}"><span>${esc(page.label)}</span></button>
  `).join("");
  $$('.page-strip button', els.pageStrip).forEach((button) => button.addEventListener("click", () => showPage(Number(button.dataset.pageIndex))));
  showPage(index);
  if (!els.pageDialog.open) els.pageDialog.showModal();
  void recordLearning("resourceOpened", {
    resourceKind: "textbook_page",
    resourceRef: state.pages[index]?.label || String(index + 1),
  });
}

function resourcePreviewUrl(href) {
  if (/\.(png|jpe?g|gif|webp|svg)(?:$|\?)/i.test(href)) return href;
  try {
    const url = new URL(href, location.href);
    if (url.origin === location.origin) return url.toString();
  } catch {}
  return `/api/preview?url=${encodeURIComponent(href)}`;
}

function openResourcePlan(plan, title, evidenceKind = "resource") {
  if (!plan || !title) return;
  els.resourceDialogTitle.textContent = title;
  els.resourceExternal.href = plan.externalHref || plan.src || "#";
  mountResourcePreview(els.resourceStage, plan, title, { eager: true, expanded: true });
  if (!els.resourceDialog.open) els.resourceDialog.showModal();
  void recordLearning(evidenceKind === "slideDeck" ? "slideDeckOpened" : "resourceOpened", {
    resourceKind: evidenceKind === "slideDeck" ? "slide_deck_pdf" : evidenceKind,
    resourceRef: String(plan.externalHref || plan.src || "").slice(0, 500),
  });
}

function openResource(resource) {
  if (!resource) return;
  openResourcePlan(
    resourcePreviewPlan(resource),
    resource.title || "學習資料",
    resource.evidenceKind === "slideDeck" ? "slideDeck" : (resource.kind || "resource"),
  );
}

function restoreInlineNoteText(content) {
  const nodes = noteAnimations.get(content)?.nodes || [];
  nodes.forEach(({ node, text }) => { node.nodeValue = text; });
}

function stopInlineNoteAnimation(content) {
  const active = noteAnimations.get(content);
  if (active?.frame) cancelAnimationFrame(active.frame);
  restoreInlineNoteText(content);
}

function typewriteInlineNote(note) {
  const content = note.querySelector(".reader-inline-note-content");
  if (!content) return;
  stopInlineNoteAnimation(content);
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
  const nodes = [];
  let node;
  while ((node = walker.nextNode())) nodes.push({ node, text: node.nodeValue || "", index: 0 });
  const total = nodes.reduce((sum, item) => sum + [...item.text].length, 0);
  nodes.forEach((item) => { item.characters = [...item.text]; item.node.nodeValue = ""; });
  const active = { nodes, frame: 0 };
  noteAnimations.set(content, active);
  const perFrame = Math.max(1, Math.ceil(total / 90));
  const tick = () => {
    let budget = perFrame;
    for (const item of nodes) {
      while (budget > 0 && item.index < item.characters.length) {
        item.node.nodeValue += item.characters[item.index++];
        budget -= 1;
      }
      if (budget <= 0) break;
    }
    if (nodes.some((item) => item.index < item.characters.length) && !note.hidden) {
      active.frame = requestAnimationFrame(tick);
    }
  };
  active.frame = requestAnimationFrame(tick);
}

function closeInlineNote(note) {
  if (!note || note.hidden) return;
  const content = note.querySelector(".reader-inline-note-content");
  if (content) stopInlineNoteAnimation(content);
  note.hidden = true;
  const button = document.querySelector(`[aria-controls="${CSS.escape(note.id)}"]`);
  button?.setAttribute("aria-expanded", "false");
  button?.setAttribute("aria-label", button.getAttribute("aria-label")?.replace(/^收起/, "展開") || "展開註釋");
}

function closeInlineNotes(except = null) {
  $$('[data-inline-note]:not([hidden])', els.textFlow).forEach((note) => {
    if (note !== except) closeInlineNote(note);
  });
}

function toggleInlineNote(button) {
  const note = document.getElementById(button.getAttribute("aria-controls") || "");
  if (!note) return;
  const opening = note.hidden;
  closeInlineNotes(opening ? note : null);
  if (!opening) {
    closeInlineNote(note);
    return;
  }
  note.hidden = false;
  button.setAttribute("aria-expanded", "true");
  button.setAttribute("aria-label", button.getAttribute("aria-label")?.replace(/^展開/, "收起") || "收起註釋");
  if (note.dataset.typed !== "true") {
    note.dataset.typed = "true";
    typewriteInlineNote(note);
  }
}

function onSelection() {
  const firstRead = state.firstReads.get(state.current?.id);
  if (firstRead && !firstRead.submitted) {
    window.YwClassicalFirstRead?.captureSelection?.(els.textFlow, firstRead, {
      toast,
      onChange: () => {
        lessonProgress().firstRead = {
          ...(lessonProgress().firstRead || {}),
          markCount: firstRead.marks.length,
          done: false,
        };
        syncProgress();
        renderCheckStage(state.current);
      },
    });
    return;
  }
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed) return;
  const text = selection.toString().trim();
  if (!text || text.length > 80) return;
  const anchor = selection.anchorNode?.parentElement;
  if (!anchor?.closest("#text-flow")) return;
  if (firstRead?.submitted && !firstRead.annotatedReadCompleted) {
    toast("讀完帶註釋正文並確認後，再使用查詞工具");
    return;
  }
  openLexicon(text);
}

function updateReadProgress() {
  if (!state.current || !state.manifest) return;
  const root = $("#textbook-text");
  const end = $("#learning-check");
  if (!root || !end) return;
  const startY = root.offsetTop;
  const endY = Math.max(startY + 1, end.offsetTop - innerHeight * 0.45);
  const ratio = clamp((scrollY - startY + innerHeight * 0.35) / (endY - startY), 0, 1);
  els.readProgress.style.width = `${ratio * 100}%`;
  if (ratio > 0.72 && !lessonProgress().readReached) {
    lessonProgress().readReached = true;
    syncProgress();
    void recordLearning("readAcknowledged", { threshold: 0.72 });
  }
}

function applyFont() {
  const parsedFontIndex = Number(state.fontIndex);
  state.fontIndex = clamp(
    Number.isInteger(parsedFontIndex) ? parsedFontIndex : DEFAULT_FONT_INDEX,
    0,
    FONT_STEPS.length - 1,
  );
  document.documentElement.style.setProperty("--reader-scale", FONT_STEPS[state.fontIndex]);
  const percent = Math.round(FONT_STEPS[state.fontIndex] * 100);
  els.fontLabel.textContent = `${percent}%`;
  els.fontDown.disabled = state.fontIndex === 0;
  els.fontUp.disabled = state.fontIndex === FONT_STEPS.length - 1;
}

function changeFont(delta) {
  state.fontIndex = clamp(state.fontIndex + delta, 0, FONT_STEPS.length - 1);
  applyFont();
  queueSharedTextScale();
}

function setMasteryCollapsed(collapsed, { persist = false } = {}) {
  els.learningRail.classList.toggle("collapsed", collapsed);
  els.masteryToggle.setAttribute("aria-expanded", String(!collapsed));
  els.masteryToggle.querySelector("i").textContent = collapsed ? "展" : "收";
  if (persist) localStorage.setItem(MASTERY_COLLAPSED_KEY, collapsed ? "1" : "0");
}

function bindEvents() {
  els.atlasOpen.addEventListener("click", openAtlas);
  els.atlasClose.addEventListener("click", closeAtlas);
  els.atlasScrim.addEventListener("click", closeAtlas);
  els.mobileToolsToggle.addEventListener("click", () => setToolsOpen(!els.body.classList.contains("tools-open")));
  $("#topbar-actions").addEventListener("click", () => setToolsOpen(false));
  els.authLogin?.addEventListener("click", () => {
    els.authLogin.href = userCenterLoginUrl();
  });
  els.search.addEventListener("input", () => {
    state.query = els.search.value;
    renderLessonIndex();
  });
  els.bookSwitcher.addEventListener("click", (event) => {
    const button = event.target.closest("[data-block]");
    if (!button) return;
    state.blockId = button.dataset.block;
    state.query = "";
    els.search.value = "";
    renderBooks();
    renderLessonIndex();
  });
  els.lessonIndex.addEventListener("click", (event) => {
    const button = event.target.closest("[data-lesson]");
    if (button) showLesson(button.dataset.lesson);
  });
  els.materialStream.addEventListener("click", (event) => {
    const button = event.target.closest("[data-resource-index]");
    if (button) {
      openResource(resourcesFor(state.current)[Number(button.dataset.resourceIndex)]);
      return;
    }
    const image = event.target.closest("img");
    if (!image) return;
    event.preventDefault();
    openResource({
      href: image.currentSrc || image.src,
      title: image.alt || lessonTitle(state.current),
      kind: "image",
    });
  });
  els.textFlow.addEventListener("click", (event) => {
    const annotatedReadButton = event.target.closest("[data-annotated-read-complete]");
    if (annotatedReadButton) {
      event.preventDefault();
      void completeAnnotatedReading(annotatedReadButton);
      return;
    }
    const note = event.target.closest(".reader-note-ref");
    if (note) {
      event.preventDefault();
      toggleInlineNote(note);
      void recordLearning("noteOpened", {
        noteRef: note.dataset.noteRef || "",
      });
      return;
    }
    const inlineNote = event.target.closest("[data-inline-note]");
    if (inlineNote) {
      closeInlineNote(inlineNote);
      return;
    }
    closeInlineNotes();
    const image = event.target.closest("img");
    if (!image) return;
    event.preventDefault();
    openResource({ href: image.currentSrc || image.src, title: image.alt || lessonTitle(state.current), kind: "image" });
  });
  document.addEventListener("mouseup", () => setTimeout(onSelection, 0));
  document.addEventListener("touchend", () => setTimeout(onSelection, 80));
  let keyboardSelectionTimer = 0;
  document.addEventListener("selectionchange", () => {
    clearTimeout(keyboardSelectionTimer);
    if (!els.textFlow.contains(document.activeElement)) return;
    keyboardSelectionTimer = setTimeout(onSelection, 180);
  });
  els.lexiconClose.addEventListener("click", closeLexicon);
  els.lexiconScrim.addEventListener("click", closeLexicon);
  $$('.lexicon-switch button').forEach((button) => button.addEventListener("click", () => {
    state.lexicon = button.dataset.lexicon;
    $$('.lexicon-switch button').forEach((item) => {
      item.classList.toggle("active", item === button);
      item.setAttribute("aria-selected", item === button ? "true" : "false");
    });
    updateLexiconFrame();
  }));
  els.pageOpen.addEventListener("click", () => openPages());
  els.pagePrev.addEventListener("click", () => showPage(state.pageIndex - 1));
  els.pageNext.addEventListener("click", () => showPage(state.pageIndex + 1));
  els.resourcesOpen.addEventListener("click", () => {
    document.querySelector("#classroom-materials")?.scrollIntoView({ behavior: "smooth", block: "start" });
  });
  document.querySelector("#lesson-chat a")?.addEventListener("click", () => {
    void recordLearning("chatOpened");
  });
  els.lessonChatLoad?.addEventListener("click", () => {
    if (
      !state.current
      || els.lessonChatLoad.dataset.lessonId !== state.current.id
      || !els.lessonChatFrame.hidden
    ) return;
    els.lessonChatPlaceholder.hidden = true;
    els.lessonChatFrame.hidden = false;
    els.lessonChatFrame.src = "https://chat.bdfz.net/#lobby";
    void recordLearning("chatOpened");
  });
  els.resourceDialog.addEventListener("close", () => { els.resourceStage.replaceChildren(); });
  els.fontDown.addEventListener("click", () => changeFont(-1));
  els.fontUp.addEventListener("click", () => changeFont(1));
  els.focusButton.addEventListener("click", () => {
    els.body.classList.toggle("focus-mode");
    const active = els.body.classList.contains("focus-mode");
    els.focusButton.setAttribute("aria-pressed", active ? "true" : "false");
    els.focusButton.textContent = active ? "退出" : "專注";
    if (els.body.classList.contains("focus-mode")) closeAtlas();
  });
  els.checkpointList.addEventListener("click", (event) => {
    const item = event.target.closest("[data-checkpoint]");
    if (!item) return;
    const target = item.dataset.checkpoint === "read"
      ? document.querySelector("#textbook-text")
      : document.querySelector(`[data-round="${item.dataset.checkpoint}"]`);
    target?.scrollIntoView({ behavior: "smooth", block: "start" });
  });
  els.masteryToggle.addEventListener("click", () => {
    const collapsed = !els.learningRail.classList.contains("collapsed");
    setMasteryCollapsed(collapsed, { persist: true });
  });
  window.addEventListener("scroll", updateReadProgress, { passive: true });
  window.addEventListener("resize", () => requestAnimationFrame(() => {
    if (matchMedia("(max-width: 1180px)").matches && els.body.classList.contains("atlas-open")) {
      closeAtlas();
    }
    fitLessonTitle();
  }), { passive: true });
  if (window.ResizeObserver && els.title?.parentElement) {
    const titleObserver = new ResizeObserver(() => requestAnimationFrame(fitLessonTitle));
    titleObserver.observe(els.title.parentElement);
  }
  window.addEventListener("hashchange", () => {
    const id = location.hash.slice(1);
    if (
      id
      && id !== state.current?.id
      && state.manifest?.lessons?.some((lesson) => lesson.id === id)
    ) {
      showLesson(id, { push: false });
    }
  });
  window.addEventListener("online", flushSharedState);
  window.addEventListener("focus", flushSharedState);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") flushSharedState();
    else resetLessonChat();
  });
  window.addEventListener("pagehide", resetLessonChat);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      const openNote = $('[data-inline-note]:not([hidden])', els.textFlow);
      const noteButton = openNote && document.querySelector(`[aria-controls="${CSS.escape(openNote.id)}"]`);
      if (openNote) {
        closeInlineNote(openNote);
        noteButton?.focus({ preventScroll: true });
      } else {
        closeLexicon();
      }
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      openAtlas();
      els.search.focus();
    }
  });
}

async function init() {
  applyFont();
  bindEvents();
  setToolsOpen(false);
  const masteryCollapsed = localStorage.getItem(MASTERY_COLLAPSED_KEY) !== "0";
  setMasteryCollapsed(masteryCollapsed);
  enforceNewTabLinks();
  new MutationObserver((mutations) => mutations.forEach((mutation) => mutation.addedNodes.forEach((node) => {
    if (node.nodeType === Node.ELEMENT_NODE) enforceNewTabLinks(node);
  }))).observe(document.body, { childList: true, subtree: true });
  if (matchMedia("(min-width: 1181px)").matches) openAtlas(); else closeAtlas();
  try {
    const [
      manifest,
      taxonomy,
      lessonMedia,
      vocabEligibility,
      vocabIndex,
      learningManifest,
      studyGuideCatalog,
      wechatArchiveMap,
      previewScreenshots,
      previewTargets,
      classicalLearningTips,
      loadedBlueprintRules,
      sharedContentPointer,
    ] = await Promise.all([
      fetchJson("data/manifest.json"),
      fetchJson("data/literary-taxonomy.json"),
      fetchJson("data/lesson-media.json"),
      fetchJson("data/vocab-eligibility.json", { cache: "no-cache" }),
      fetchJson("data/vocab/index.json", { cache: "no-cache" }),
      fetchJson("data/learning-manifest.json", { cache: "no-cache" }),
      fetchJson("data/study-guide-catalog.json", { cache: "no-cache" }),
      fetchJson("data/wechat-archive-map.json", { cache: "no-cache" }),
      fetchJson("data/preview-screenshots.json", { cache: "no-cache" }),
      fetchJson("data/preview-targets.json", { cache: "no-cache" }),
      fetchJson("data/classical-learning-tips.json", { cache: "no-cache" }),
      import(LESSON_BLUEPRINT_RULES_URL),
      fetchJson("app-content/latest-stable.json", { cache: "no-cache" }).catch(() => null),
    ]);
    if (
      vocabEligibility?.schemaVersion !== "yw-vocab-eligibility-v1"
      || vocabIndex?.schemaVersion !== "yw-vocab-index-v2"
      || learningManifest?.schemaVersion !== 1
      || studyGuideCatalog?.schemaVersion !== "yw-study-guide-catalog-v1"
      || wechatArchiveMap?.schemaVersion !== "yw-wechat-archive-map-v1"
      || !Array.isArray(wechatArchiveMap?.entries)
      || previewScreenshots?.schemaVersion !== "yw-preview-screenshots-v1"
      || !Array.isArray(previewScreenshots?.entries)
      || previewTargets?.schemaVersion !== "yw-preview-targets-v1"
      || !Array.isArray(previewTargets?.directRemoteAppRoots)
      || classicalLearningTips?.schemaVersion !== "yw-classical-learning-tips-v1"
      || !Array.isArray(classicalLearningTips?.lessons)
      || typeof loadedBlueprintRules?.deterministicLessonBlueprint !== "function"
    ) {
      throw new Error("字詞範圍資料不一致");
    }
    state.manifest = manifest;
    state.taxonomy = taxonomy;
    state.vocabEligibility = vocabEligibility;
    state.vocabIndex = vocabIndex;
    state.formalVocabResourceKeys = window.YwVocabProgress.formalVocabularyResourceKeys(
      learningManifest,
    );
    window.YwVocabProgress.validateVocabularyAuthority(
      state.formalVocabResourceKeys,
      state.vocabIndex.activeItemIds,
    );
    state.studyGuideLessons = new Map((studyGuideCatalog.lessons || []).map((lesson) => [lesson.lessonId, lesson]));
    state.wechatArchiveBySource = new Map(wechatArchiveMap.entries.map((entry) => [resourceIdentity(entry.sourceUrl), entry]));
    state.previewScreenshotBySource = new Map(previewScreenshots.entries.map((entry) => [resourceIdentity(entry.sourceUrl), entry]));
    state.directRemoteAppRoots = new Set(previewTargets.directRemoteAppRoots);
    state.classicalLearningTips = new Map(classicalLearningTips.lessons.map((entry) => [entry.lessonId, entry]));
    lessonBlueprintRules = loadedBlueprintRules;
    state.sharedContentVersion = sharedContentVersionFromPointer(sharedContentPointer);
    state.lessonMedia = new Map((lessonMedia.lessons || []).map((lesson) => [lesson.lessonId, lesson]));
    state.taxonomyLessons = new Map(state.taxonomy.lessons.map((lesson) => [lesson.id, lesson]));
    state.taxonomyGenres = new Map(state.taxonomy.genres.map((genre) => [genre.id, genre]));
    const defaultBlock = state.manifest.blocks.find((block) => block.id === "xuanbi-shang" || block.title === "選必上") || state.manifest.blocks[0];
    state.blockId = defaultBlock?.id || "";
    const studentLessons = studentVisibleLessons();
    els.atlasStatus.textContent = `${studentLessons.length} 篇 · 五冊教材`;
    renderBooks();
    renderLessonIndex();
    const hashId = location.hash.slice(1);
    const rememberedId = readScopedUiValue(LAST_LESSON_KEY) || "";
    const initial = studentLessons.find((lesson) => lesson.id === hashId)
      || studentLessons.find((lesson) => lesson.id === rememberedId)
      || defaultBlock?.lessons.find((lesson) => !isUnitHeading(lesson) && !isRetiredMirror(lesson) && (lesson.excerpt || "").length > 100)
      || studentLessons[0];
    if (initial) await showLesson(initial.id, { push: true, syncSharedState: false });
    void flushSharedState();
  } catch (error) {
    els.atlasStatus.textContent = "教材資料載入失敗";
    els.title.textContent = "暫時無法打開教材";
    els.orientation.textContent = error.message;
  }
}

init();
