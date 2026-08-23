(() => {
  "use strict";

  const STORAGE_PREFIX = "yw-classical-first-read-local-v1";
  const MAX_SELECTION_CHARS = 120;

  function esc(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;",
    }[char]));
  }

  function localKey(asset) {
    return `${STORAGE_PREFIX}:${asset.lessonId}:${asset.textVersionId}`;
  }

  function clearLegacyLocal(asset) {
    try { localStorage.removeItem(localKey(asset)); } catch { /* storage unavailable */ }
  }

  function elapsedMs(session) {
    return Math.min(
      12 * 60 * 60 * 1000,
      Math.max(0, Number(session.elapsedMs || 0) + (performance.now() - session.openedAt)),
    );
  }

  async function responseJson(response) {
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload.error || `請求失敗 ${response.status}`);
      error.status = response.status;
      throw error;
    }
    return payload;
  }

  async function load(lessonId) {
    const assetResponse = await fetch(`data/classical-first-read/${encodeURIComponent(lessonId)}.json`, {
      headers: { accept: "application/json" },
      cache: "no-cache",
    });
    if (!assetResponse.ok) return null;
    const asset = await assetResponse.json();
    if (asset.schema !== "yw-classical-first-read-v1"
        || Number(asset.schemaVersion) !== 1
        || asset.offsetUnit !== "utf16_code_unit"
        || asset.lessonId !== lessonId) {
      throw new Error("無標點正文契約不一致");
    }

    let remote = null;
    let authMode = "offline";
    try {
      const response = await fetch(`/api/reading/first-read/state/${encodeURIComponent(lessonId)}`, {
        headers: { accept: "application/json" },
        cache: "no-store",
      });
      if (response.status === 401) authMode = "local";
      else {
        remote = await responseJson(response);
        authMode = "authenticated";
      }
    } catch {
      authMode = "offline";
    }

    if (authMode === "authenticated" && (
      String(remote?.lessonId || "") !== asset.lessonId
      || String(remote?.textVersionId || "") !== asset.textVersionId
      || String(remote?.textDigest || "") !== asset.textDigest
    )) {
      throw new Error("初讀權威版本與正文不一致");
    }

    clearLegacyLocal(asset);
    const fallback = remote || {};
    const session = {
      asset,
      authMode,
      authorityLessonId: fallback.lessonId || null,
      authorityTextVersionId: fallback.textVersionId || null,
      authorityTextDigest: fallback.textDigest || null,
      submitted: Boolean(fallback.submitted || fallback.unlocked),
      submittedAt: fallback.submittedAt || null,
      annotatedReadCompleted: Boolean(fallback.annotatedReadCompleted),
      summary: fallback.summary || "",
      elapsedMs: Number(fallback.elapsedMs || 0),
      openedAt: performance.now(),
      marks: Array.isArray(fallback.marks) ? fallback.marks : [],
      pending: null,
    };
    if (authMode === "authenticated" && session.submitted) {
      void apiPost("/api/reading/first-read/reconcile", session, {}).catch(() => {});
    }
    return session;
  }

  function authNotice(session) {
    if (session.authMode === "authenticated") {
      return '<p class="first-read-sync synced"><b>學情同步中</b><span>標記、猜測與耗時會保存到你的本課學習記錄。</span></p>';
    }
    if (session.authMode === "local") {
      const returnTo = encodeURIComponent(location.href);
      return `<p class="first-read-sync local"><b>登入後開始標記</b><span>初讀猜測屬於個人學情，不會匿名留在共用裝置。</span><a href="https://my.bdfz.net/?returnTo=${returnTo}">登入 ↗</a></p>`;
    }
    return '<p class="first-read-sync local"><b>學情同步暫時不可用</b><span>正文仍可初讀；恢復連線並登入後才可保存標記與解鎖下一關。</span></p>';
  }

  function sortedVisibleMarks(session, paragraphKey) {
    const marks = session.marks
      .filter((mark) => mark.paragraphKey === paragraphKey)
      .sort((a, b) => a.startOffset - b.startOffset || a.endOffset - b.endOffset);
    const visible = [];
    let cursor = 0;
    marks.forEach((mark) => {
      if (mark.startOffset < cursor) return;
      visible.push(mark);
      cursor = mark.endOffset;
    });
    return visible;
  }

  function markedText(session, paragraph) {
    const marks = sortedVisibleMarks(session, paragraph.key);
    let cursor = 0;
    const parts = [];
    marks.forEach((mark) => {
      parts.push(esc(paragraph.text.slice(cursor, mark.startOffset)));
      parts.push(`<mark class="first-read-mark ${mark.resolutionStatus === "resolved" ? "resolved" : ""}" data-mark-id="${esc(mark.markId)}">${esc(paragraph.text.slice(mark.startOffset, mark.endOffset))}</mark>`);
      cursor = mark.endOffset;
    });
    parts.push(esc(paragraph.text.slice(cursor)));
    return parts.join("");
  }

  function renderParagraphs(session) {
    return session.asset.paragraphs.map((paragraph) => `<p class="first-read-paragraph" tabindex="0" data-first-read-paragraph="${esc(paragraph.key)}" data-ordinal="${Number(paragraph.ordinal)}">${markedText(session, paragraph)}</p>`).join("");
  }

  function renderMarkList(session) {
    if (!session.marks.length) {
      return '<p class="first-read-empty">拖選或雙擊正文中的疑難字詞句，先留下你的第一直覺。</p>';
    }
    return session.marks.map((mark, index) => `
      <article class="first-read-mark-card">
        <header><span>${String(index + 1).padStart(2, "0")}</span><strong>${esc(mark.selectedText)}</strong>${session.submitted ? "" : `<button type="button" data-first-read-delete="${esc(mark.markId)}" aria-label="刪除「${esc(mark.selectedText)}」標記">刪除</button>`}</header>
        <p>${esc(mark.guess || "")}</p>
      </article>`).join("");
  }

  function renderPending(session) {
    if (!session.pending) return "";
    return `
      <form class="first-read-guess-form" data-first-read-guess-form>
        <span>你標記了</span>
        <strong>${esc(session.pending.selectedText)}</strong>
        <label>第一直覺猜測
          <textarea name="guess" rows="3" maxlength="600" required placeholder="我猜它在這裡是……；也可能難在斷句……"></textarea>
        </label>
        <div><button type="button" data-first-read-cancel>取消</button><button type="submit">保存紅筆標記</button></div>
      </form>`;
  }

  function keyboardMarkerHtml(session) {
    if (session.authMode !== "authenticated" || session.pending) return "";
    return `<details class="first-read-keyboard-marker">
      <summary>不用滑鼠：輸入原文中的疑難字詞句</summary>
      <form data-first-read-keyboard-form>
        <label>所在段落<select name="paragraphKey" required>${session.asset.paragraphs.map((paragraph) => (
          `<option value="${esc(paragraph.key)}">第 ${Number(paragraph.ordinal)} 段 · ${esc(paragraph.text.slice(0, 18))}…</option>`
        )).join("")}</select></label>
        <label>原文中的字詞句<input name="selectedText" maxlength="120" required></label>
        <label>第一直覺猜測<textarea name="guess" rows="3" maxlength="600" required></textarea></label>
        <button type="submit">保存紅筆標記</button>
      </form>
    </details>`;
  }

  function sidebarHtml(session) {
    return `
      ${authNotice(session)}
      <div class="first-read-counter"><span>疑難標記</span><strong>${session.marks.length} / 至少 3 處</strong></div>
      ${renderPending(session)}
      ${keyboardMarkerHtml(session)}
      <div class="first-read-mark-list">${renderMarkList(session)}</div>
      <form class="first-read-submit" data-first-read-submit>
        <label>初讀感知
          <textarea name="summary" rows="5" minlength="12" maxlength="2000" required placeholder="粗讀後，我大概讀懂了文章講述的是……">${esc(session.summary)}</textarea>
        </label>
        <button type="submit" ${session.authMode !== "authenticated" || session.marks.length < 3 ? "disabled" : ""}>提交初讀，解鎖正文與註釋</button>
        <small>提交後保留原始猜測；細讀時用藍筆訂正，不覆寫第一次閱讀。</small>
      </form>`;
  }

  function renderGate(session) {
    return `
      <section class="first-read-gate" aria-labelledby="first-read-heading">
        <header class="first-read-heading">
          <div><span>關卡一 · 起始</span><h3 id="first-read-heading">無注疏初讀</h3></div>
          <p>無標點 · 無註釋 · 暫停查詞</p>
          <small class="first-read-authority">依教材正式正文生成，採用學案初讀流程；學案補遺保留在後續資料區。</small>
        </header>
        <div class="first-read-layout">
          <div class="first-read-document" aria-label="無標點初讀正文">
            <p class="first-read-instruction">先自行斷句。拖選或雙擊不懂的字、詞、句，紅筆標記並寫下第一直覺。</p>
            <div class="first-read-text">${renderParagraphs(session)}</div>
          </div>
          <aside class="first-read-sidebar" aria-label="初讀疑難記錄欄" data-first-read-sidebar>${sidebarHtml(session)}</aside>
        </div>
      </section>`;
  }

  function renderSubmittedParagraphs(session) {
    return session.asset.paragraphs.map((paragraph) => `
      <p class="first-read-paragraph" data-first-read-submitted-paragraph="${esc(paragraph.key)}" data-ordinal="${Number(paragraph.ordinal)}">${markedText(session, paragraph)}</p>`).join("");
  }

  function renderSubmittedMarks(session) {
    if (!session.marks.length) {
      return '<p class="first-read-empty">本次初讀沒有留下疑難標記。</p>';
    }
    return session.marks.map((mark, index) => `
      <article class="first-read-mark-card">
        <header><span>${String(index + 1).padStart(2, "0")}</span><strong>${esc(mark.selectedText)}</strong></header>
        <p>${esc(mark.guess || "")}</p>
      </article>`).join("");
  }

  function renderSubmittedReading(session) {
    if (!session?.submitted || !session.asset || !Array.isArray(session.asset.paragraphs)) return "";
    const safeSession = {
      ...session,
      marks: Array.isArray(session.marks) ? session.marks : [],
      summary: String(session.summary || ""),
    };
    return `
      <section class="first-read-submitted-review" data-first-read-submitted-review aria-labelledby="first-read-submitted-heading">
        <header class="first-read-submitted-heading">
          <div><span>起始</span><h3 id="first-read-submitted-heading">無注疏初讀</h3></div>
          <p>已提交 · 保留第一次閱讀</p>
        </header>
        <div class="first-read-submitted-layout">
          <div class="first-read-submitted-document" aria-label="已提交的無注疏初讀正文">
            <p class="first-read-instruction">這是解鎖前讀過的無標點正文；原始紅筆標記保持不變，可隨時與帶註釋正文對照。</p>
            <div class="first-read-text">${renderSubmittedParagraphs(safeSession)}</div>
          </div>
          <aside class="first-read-submitted-record" aria-label="已提交的初讀記錄">
            <section class="first-read-submitted-summary">
              <span>初讀感知</span>
              <p>${esc(safeSession.summary) || "未留下初讀感知。"}</p>
            </section>
            <section class="first-read-submitted-marks" aria-label="初讀疑難標記">
              <header><span>疑難標記</span><strong>${safeSession.marks.length}</strong></header>
              <div class="first-read-mark-list">${renderSubmittedMarks(safeSession)}</div>
            </section>
          </aside>
        </div>
      </section>`;
  }

  function refreshGate(root, session, handlers) {
    const text = root.querySelector(".first-read-text");
    const sidebar = root.querySelector("[data-first-read-sidebar]");
    if (text) text.innerHTML = renderParagraphs(session);
    if (sidebar) sidebar.innerHTML = sidebarHtml(session);
    bindGate(root, session, handlers);
  }

  function mutationId(session, action, extra = "") {
    const stable = [action, session.asset.lessonId, session.asset.textVersionId, extra].join(":");
    return stable.length <= 100 ? stable : `${action}:${crypto.randomUUID()}`;
  }

  async function apiPost(path, session, payload) {
    const response = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        lessonId: session.asset.lessonId,
        textVersionId: session.asset.textVersionId,
        textDigest: session.asset.textDigest,
        elapsedMs: Math.round(elapsedMs(session)),
        ...payload,
      }),
    });
    return responseJson(response);
  }

  function paragraphForPending(session) {
    return session.asset.paragraphs.find((paragraph) => paragraph.key === session.pending?.paragraphKey);
  }

  async function savePending(root, session, handlers, guess) {
    if (session.authMode !== "authenticated") throw new Error("請先登入再保存初讀標記");
    const paragraph = paragraphForPending(session);
    if (!paragraph || !session.pending) throw new Error("標記位置已失效，請重新選取");
    const pending = { ...session.pending, guess: String(guess || "").trim() };
    if (!pending.guess) throw new Error("請先寫下第一直覺猜測");
    let mark = {
      ...pending,
      markId: `local:${pending.paragraphKey}:${pending.startOffset}:${pending.endOffset}`,
      resolutionStatus: "open",
      correction: "",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const result = await apiPost("/api/reading/first-read/mark", session, {
      ...pending,
      clientMutationId: mutationId(session, "first-read-mark", `${pending.paragraphKey}:${pending.startOffset}:${pending.endOffset}`),
    });
    mark = result.mark;
    const existing = session.marks.findIndex((item) => (
      item.paragraphKey === mark.paragraphKey
      && item.startOffset === mark.startOffset
      && item.endOffset === mark.endOffset
    ));
    if (existing >= 0) session.marks.splice(existing, 1, mark);
    else session.marks.push(mark);
    session.pending = null;
    refreshGate(root, session, handlers);
    handlers.onChange?.(session);
  }

  async function deleteMark(root, session, handlers, markId) {
    if (session.authMode !== "authenticated") throw new Error("請先登入再修改初讀標記");
    const mark = session.marks.find((item) => item.markId === markId);
    if (!mark) return;
    await apiPost("/api/reading/first-read/mark/delete", session, { markId });
    session.marks = session.marks.filter((item) => item.markId !== markId);
    refreshGate(root, session, handlers);
    handlers.onChange?.(session);
  }

  async function submitGate(root, session, handlers, summary) {
    if (session.authMode !== "authenticated") throw new Error("請先登入並同步初讀學情");
    const cleanSummary = String(summary || "").trim();
    if (session.marks.length < 3) throw new Error("至少完成 3 處疑難標記");
    if ([...cleanSummary].length < 12) throw new Error("初讀感知至少 12 字");
    let result;
    try {
      result = await apiPost("/api/reading/first-read/submit", session, {
        summary: cleanSummary,
        clientMutationId: mutationId(session, "first-read-submit"),
      });
    } catch (submitError) {
      // The source session is committed before its compensating learning-evidence
      // write. A timeout or post-commit failure is therefore ambiguous: read the
      // authenticated source of truth before leaving the student on a stale gate.
      let authoritative = null;
      try {
        authoritative = await load(session.asset.lessonId);
      } catch {
        // Preserve the original submit error when the authority cannot be read.
      }
      if (!authoritative?.submitted
          || authoritative.authMode !== "authenticated"
          || authoritative.authorityLessonId !== (session.authorityLessonId || session.asset.lessonId)
          || authoritative.authorityTextVersionId !== (session.authorityTextVersionId || session.asset.textVersionId)
          || authoritative.authorityTextDigest !== (session.authorityTextDigest || session.asset.textDigest)) {
        throw submitError;
      }
      Object.assign(session, {
        authMode: authoritative.authMode,
        authorityLessonId: authoritative.authorityLessonId,
        authorityTextVersionId: authoritative.authorityTextVersionId,
        authorityTextDigest: authoritative.authorityTextDigest,
        submitted: true,
        submittedAt: authoritative.submittedAt,
        annotatedReadCompleted: authoritative.annotatedReadCompleted,
        summary: authoritative.summary,
        elapsedMs: authoritative.elapsedMs,
        openedAt: authoritative.openedAt,
        marks: authoritative.marks,
        pending: null,
      });
      handlers.onUnlock?.(session);
      return;
    }
    session.submittedAt = result.submittedAt;
    session.summary = cleanSummary;
    session.submitted = true;
    session.elapsedMs = Math.round(elapsedMs(session));
    session.openedAt = performance.now();
    handlers.onUnlock?.(session);
  }

  function bindGate(root, session, handlers = {}) {
    const sidebar = root.querySelector("[data-first-read-sidebar]");
    if (!sidebar) return;
    sidebar.querySelector("[data-first-read-guess-form]")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const button = event.submitter;
      if (button) button.disabled = true;
      try {
        await savePending(root, session, handlers, new FormData(event.currentTarget).get("guess"));
      } catch (error) {
        handlers.toast?.(error.message || "標記未保存");
        if (button) button.disabled = false;
      }
    });
    sidebar.querySelector("[data-first-read-cancel]")?.addEventListener("click", () => {
      session.pending = null;
      refreshGate(root, session, handlers);
    });
    sidebar.querySelector("[data-first-read-keyboard-form]")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const button = event.submitter;
      if (button) button.disabled = true;
      try {
        const values = new FormData(event.currentTarget);
        const paragraphKey = String(values.get("paragraphKey") || "");
        const selectedText = String(values.get("selectedText") || "").trim();
        const paragraph = session.asset.paragraphs.find((item) => item.key === paragraphKey);
        if (!paragraph || !selectedText || [...selectedText].length > MAX_SELECTION_CHARS) {
          throw new Error("請輸入本段原文中 1 至 120 字的疑難處");
        }
        const startOffset = paragraph.text.indexOf(selectedText);
        if (startOffset < 0) throw new Error("這段原文中沒有完全相同的字詞句");
        if (paragraph.text.indexOf(selectedText, startOffset + selectedText.length) >= 0) {
          throw new Error("本段有多處相同文字，請輸入更完整的上下文");
        }
        const endOffset = startOffset + selectedText.length;
        const overlaps = session.marks.some((mark) => (
          mark.paragraphKey === paragraphKey
          && startOffset < mark.endOffset
          && endOffset > mark.startOffset
        ));
        if (overlaps) throw new Error("這一處與已有標記重疊，請換一處疑難");
        session.pending = { paragraphKey, startOffset, endOffset, selectedText };
        await savePending(root, session, handlers, values.get("guess"));
      } catch (error) {
        handlers.toast?.(error.message || "標記未保存");
        if (button) button.disabled = false;
      }
    });
    sidebar.querySelectorAll("[data-first-read-delete]").forEach((button) => button.addEventListener("click", async () => {
      button.disabled = true;
      try {
        await deleteMark(root, session, handlers, button.dataset.firstReadDelete);
      } catch (error) {
        handlers.toast?.(error.message || "標記未刪除");
        button.disabled = false;
      }
    }));
    sidebar.querySelector("[data-first-read-submit]")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const button = event.submitter;
      if (button) button.disabled = true;
      try {
        await submitGate(root, session, handlers, new FormData(event.currentTarget).get("summary"));
      } catch (error) {
        handlers.toast?.(error.message || "初讀未提交");
        if (button) button.disabled = false;
      }
    });
  }

  function captureSelection(root, session, handlers = {}) {
    if (!session || session.submitted) return false;
    if (session.authMode !== "authenticated") {
      handlers.toast?.("請先登入，再保存初讀疑難標記");
      return true;
    }
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount !== 1) return true;
    const range = selection.getRangeAt(0);
    const elementFor = (node) => (node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement);
    const startParagraph = elementFor(range.startContainer)?.closest?.("[data-first-read-paragraph]");
    const endParagraph = elementFor(range.endContainer)?.closest?.("[data-first-read-paragraph]");
    if (!startParagraph || startParagraph !== endParagraph || !root.contains(startParagraph)) {
      handlers.toast?.("一次只標記同一段中的字詞句");
      selection.removeAllRanges();
      return true;
    }
    const paragraphKey = startParagraph.dataset.firstReadParagraph;
    const paragraph = session.asset.paragraphs.find((item) => item.key === paragraphKey);
    if (!paragraph) return true;
    const prefix = range.cloneRange();
    prefix.selectNodeContents(startParagraph);
    prefix.setEnd(range.startContainer, range.startOffset);
    const startOffset = prefix.toString().length;
    const selectedText = range.toString();
    const endOffset = startOffset + selectedText.length;
    if (!selectedText.trim() || [...selectedText].length > MAX_SELECTION_CHARS) {
      handlers.toast?.("每處標記請選 1 至 120 字");
      selection.removeAllRanges();
      return true;
    }
    if (paragraph.text.slice(startOffset, endOffset) !== selectedText) {
      handlers.toast?.("標記位置未能確認，請重新選取");
      selection.removeAllRanges();
      return true;
    }
    const overlaps = session.marks.some((mark) => (
      mark.paragraphKey === paragraphKey
      && startOffset < mark.endOffset
      && endOffset > mark.startOffset
      && !(startOffset === mark.startOffset && endOffset === mark.endOffset)
    ));
    if (overlaps) {
      handlers.toast?.("這一處與已有標記重疊，請調整選取範圍");
      selection.removeAllRanges();
      return true;
    }
    session.pending = { paragraphKey, startOffset, endOffset, selectedText };
    const sidebar = root.querySelector("[data-first-read-sidebar]");
    if (sidebar) {
      sidebar.innerHTML = sidebarHtml(session);
      bindGate(root, session, handlers);
      sidebar.querySelector("textarea[name=guess]")?.focus();
      sidebar.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
    selection.removeAllRanges();
    return true;
  }

  function renderCorrections(session) {
    if (!session?.submitted) return "";
    const resolved = session.marks.filter((mark) => mark.resolutionStatus === "resolved").length;
    return `
      <section class="first-read-corrections" aria-label="初讀疑難紅藍對照">
        <header><div><span>紅藍對照</span><strong>初讀猜測 → 細讀訂正</strong></div><b>${resolved} / ${session.marks.length}</b></header>
        ${session.marks.map((mark) => `
          <article class="correction-card ${mark.resolutionStatus === "resolved" ? "resolved" : ""}" data-correction-mark="${esc(mark.markId)}">
            <p><mark>${esc(mark.selectedText)}</mark><span>紅筆初猜</span>${esc(mark.guess || "")}</p>
            ${mark.resolutionStatus === "resolved"
              ? `<p class="correction-saved"><span>藍筆訂正</span>${esc(mark.correction || "已解決")}</p>`
              : `<form data-first-read-correction><label>對照正文註釋或查詞後，用藍筆訂正<textarea name="correction" rows="3" maxlength="1200" required></textarea></label><button type="submit">確認已解決</button></form>`}
          </article>`).join("")}
      </section>`;
  }

  function bindCorrections(root, session, handlers = {}) {
    root.querySelectorAll("[data-first-read-correction]").forEach((form) => form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const host = form.closest("[data-correction-mark]");
      const mark = session.marks.find((item) => item.markId === host?.dataset.correctionMark);
      const correction = String(new FormData(form).get("correction") || "").trim();
      if (!mark || !correction) return;
      const button = event.submitter;
      if (button) button.disabled = true;
      try {
        if (session.authMode !== "authenticated") throw new Error("請先登入再保存訂正");
        await apiPost("/api/reading/first-read/resolve", session, {
          markId: mark.markId,
          correction,
        });
        mark.correction = correction;
        mark.resolutionStatus = "resolved";
        mark.updatedAt = new Date().toISOString();
        handlers.onChange?.(session);
      } catch (error) {
        handlers.toast?.(error.message || "訂正未保存");
        if (button) button.disabled = false;
      }
    }));
  }

  window.YwClassicalFirstRead = Object.freeze({
    load,
    renderGate,
    renderSubmittedReading,
    bindGate,
    captureSelection,
    renderCorrections,
    bindCorrections,
  });
})();
