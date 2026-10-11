// Textbook page plates: lesson -> current-edition PDF pages rendered by sun.bdfz.net.
//
// The only source of a plate address is data/textbook-pages.v1.json (written by
// scripts/resolve_textbook_pages.mjs).  Nothing here reads the legacy image
// fields kept in a lesson file, and no other origin is ever built.

export const TEXTBOOK_PAGES_SCHEMA = "yw-textbook-pages-v1";
export const TEXTBOOK_IMAGE_HOST = "sun.bdfz.net";
export const TEXTBOOK_IMAGE_ORIGIN = `https://${TEXTBOOK_IMAGE_HOST}`;
export const TEXTBOOK_IMAGE_WIDTHS = Object.freeze([240, 480, 960, 1440]);
export const PLATE_RETRY_MS = Object.freeze([3000, 6000, 12000]);
export const THUMBNAIL_CONCURRENCY = 2;

const EDITION_ID = /^[a-z]{2}-[0-9a-f-]{36}-[0-9a-f]{12}$/;
const SHA12 = /^[0-9a-f]{12}$/;

export function validTextbookPages(data) {
  return Boolean(
    data
    && data.schema === TEXTBOOK_PAGES_SCHEMA
    && data.imageHost === TEXTBOOK_IMAGE_HOST
    && typeof data.catalogRelease === "string"
    && data.books && typeof data.books === "object"
    && data.lessons && typeof data.lessons === "object"
    && TEXTBOOK_IMAGE_WIDTHS.includes(data.widths?.thumb)
    && TEXTBOOK_IMAGE_WIDTHS.includes(data.widths?.full)
    && TEXTBOOK_IMAGE_WIDTHS.includes(data.widths?.large),
  );
}

function bookFor(data, bookId) {
  const book = data?.books?.[bookId];
  if (
    !book
    || !EDITION_ID.test(String(book.editionId || ""))
    || !SHA12.test(String(book.pdfSha12 || ""))
    || !book.editionId.endsWith(`-${book.pdfSha12}`)
    || !Number.isInteger(book.pdfPages)
  ) return null;
  return book;
}

function validPage(book, pdfPage) {
  return Number.isInteger(pdfPage) && pdfPage >= 1 && pdfPage <= book.pdfPages;
}

// Immutable address: it names the edition and the PDF's hash, so it changes with the edition.
export function plateUrl(data, bookId, pdfPage, width) {
  const book = bookFor(data, bookId);
  if (!book || !validPage(book, pdfPage) || !TEXTBOOK_IMAGE_WIDTHS.includes(width)) return "";
  return `${TEXTBOOK_IMAGE_ORIGIN}/files/page/${book.editionId}/${book.pdfSha12}/${pdfPage}.webp?w=${width}`;
}

export function plateViewerUrl(data, bookId, pdfPage) {
  const book = bookFor(data, bookId);
  if (!book || !validPage(book, pdfPage)) return "";
  return `${TEXTBOOK_IMAGE_ORIGIN}/?view=pdf&edition=${encodeURIComponent(book.editionId)}&p=${pdfPage}`;
}

export function plateLabel(page) {
  return page.printed ? `第 ${page.printed} 頁` : `PDF 第 ${page.pdf} 頁`;
}

// The non-scoring "textbook page opened" trace keeps its existing `p<index>`
// form (the legacy image index of the page shown); "" when the page has none.
export function plateTraceLabel(page) {
  return Number.isInteger(page?.legacyRef) && page.legacyRef >= 0 ? `p${page.legacyRef}` : "";
}

// state: "unavailable" (no page data), "absent" (lesson has no textbook pages),
// "none" (its pages have no counterpart in the current edition) or "ready".
export function lessonPlates(data, lessonId, { large = false } = {}) {
  if (!validTextbookPages(data)) return { state: "unavailable", pages: [], notes: [], bookTitle: "" };
  const entry = data.lessons[lessonId];
  if (!entry) return { state: "absent", pages: [], notes: [], bookTitle: "" };
  const book = bookFor(data, entry.book);
  if (!book) return { state: "unavailable", pages: [], notes: [], bookTitle: "" };
  const fullWidth = large ? data.widths.large : data.widths.full;
  const pages = [];
  for (const page of Array.isArray(entry.pages) ? entry.pages : []) {
    const src = plateUrl(data, entry.book, page.pdf, fullWidth);
    const thumb = plateUrl(data, entry.book, page.pdf, data.widths.thumb);
    if (!src || !thumb) continue;
    pages.push({
      pdf: page.pdf,
      label: plateLabel(page),
      src,
      thumb,
      viewer: plateViewerUrl(data, entry.book, page.pdf),
      traceLabel: plateTraceLabel(page),
      fromOverride: page.override === true,
      revised: page.revised === true,
    });
  }
  const notes = [];
  const unmapped = Array.isArray(entry.unmappedLegacy) ? entry.unmappedLegacy.length : 0;
  if (pages.length === 0) {
    notes.push("本課原教材圖頁在現行版教材中沒有對應頁，故不顯示圖。");
  } else if (entry.status === "override") {
    // The range was proven from the current edition itself, so nothing is said
    // about legacy pages that have no counterpart.
    notes.push("本課圖頁已依現行版教材的目錄與課題位置校定。");
  } else if (unmapped > 0) {
    notes.push(`本課原教材圖頁另有 ${unmapped} 頁在現行版教材中沒有對應頁，未顯示。`);
  }
  if (entry.status !== "override" && Array.isArray(entry.unlistedBetween) && entry.unlistedBetween.length) {
    notes.push(`注意：現行版教材 PDF 第 ${entry.unlistedBetween.join("、")} 頁也屬本課範圍，但此處未顯示，請在 PDF 中打開閱讀，以免漏讀。`);
  }
  return {
    state: pages.length ? "ready" : "none",
    pages,
    notes,
    bookTitle: String(book.title || ""),
  };
}

export function startPlateLabel(data, lessonId) {
  if (!validTextbookPages(data)) return "";
  const first = data.lessons[lessonId]?.pages?.[0];
  return first?.printed ? `頁 ${first.printed}` : "";
}

// A failed plate is usually transient (cold render queue or rate limit): wait
// about 3, 6 and 12 s (plus 0-25 % jitter), then give up.  null = no more tries.
export function plateRetryDelay(attempt, random = Math.random) {
  const base = PLATE_RETRY_MS[attempt];
  return base == null ? null : Math.round(base * (1 + 0.25 * random()));
}

// One <img> with bounded retry.  Retries park while the tab is hidden and stop
// for good when another page is shown or the dialog closes (cancel()).
export function createPlateLoader({ image, onState, isHidden, setTimer = setTimeout, clearTimer = clearTimeout, random = Math.random }) {
  let current = { src: "", attempt: 0, timer: 0, parked: false, serial: 0 };
  const stop = () => {
    clearTimer(current.timer);
    current.timer = 0;
    current.parked = false;
  };
  const reload = (serial) => {
    if (serial !== current.serial || !current.src) return;
    current.parked = false;
    image.removeAttribute("src");
    image.src = current.src;
  };
  image.addEventListener("load", () => {
    if (!current.src) return;
    stop();
    current.attempt = 0;
    onState("loaded");
  });
  image.addEventListener("error", () => {
    if (!current.src || !image.getAttribute("src")) return;
    const delay = plateRetryDelay(current.attempt, random);
    if (delay == null) {
      stop();
      onState("failed");
      return;
    }
    current.attempt += 1;
    onState("retrying");
    const serial = current.serial;
    current.timer = setTimer(() => {
      if (serial !== current.serial) return;
      current.timer = 0;
      if (isHidden()) current.parked = true;
      else reload(serial);
    }, delay);
  });
  return {
    show(src) {
      stop();
      current = { src, attempt: 0, timer: 0, parked: false, serial: current.serial + 1 };
      image.removeAttribute("src");
      if (src) {
        image.hidden = false;
        image.src = src;
        onState("loading");
      } else {
        image.hidden = true;
        onState("empty");
      }
    },
    cancel() {
      stop();
      current = { src: "", attempt: 0, timer: 0, parked: false, serial: current.serial + 1 };
      image.removeAttribute("src");
    },
    resume() {
      if (current.parked && !isHidden()) reload(current.serial);
    },
    retry() {
      if (!current.src) return;
      stop();
      current.attempt = 0;
      onState("loading");
      reload(current.serial);
    },
  };
}

// Thumbnails load a few at a time, in order, with no retry: the render host
// answers 503 beyond a small number of concurrent renders.
export function createThumbnailQueue({ concurrency = THUMBNAIL_CONCURRENCY } = {}) {
  let serial = 0;
  return {
    load(images) {
      serial += 1;
      const run = serial;
      const pending = [...images];
      const next = () => {
        if (run !== serial) return;
        const image = pending.shift();
        if (!image) return;
        const done = () => {
          image.removeEventListener("load", done);
          image.removeEventListener("error", failed);
          next();
        };
        const failed = () => {
          image.removeAttribute("src");
          image.hidden = true;
          done();
        };
        image.addEventListener("load", done);
        image.addEventListener("error", failed);
        image.src = image.dataset.plateThumb;
      };
      for (let i = 0; i < Math.max(1, concurrency); i += 1) next();
    },
    cancel() {
      serial += 1;
    },
  };
}
