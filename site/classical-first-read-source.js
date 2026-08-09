const FIRST_READ_SCHEMA = "yw-classical-first-read-v1";
const MAX_MARKS_PER_LESSON = 80;
const MAX_SELECTED_CHARS = 120;
const MAX_GUESS_CHARS = 600;
const MAX_CORRECTION_CHARS = 1200;
const MAX_SUMMARY_CHARS = 2000;
const MAX_ELAPSED_MS = 12 * 60 * 60 * 1000;

function clean(value, max) {
  return String(value ?? "").replace(/\r/g, "").trim().slice(0, max);
}

function integer(value, min, max) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) return null;
  return number;
}

function isoNow() {
  return new Date().toISOString();
}

async function sha256(value) {
  const bytes = new TextEncoder().encode(String(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function firstReadAssetPath(lessonId) {
  return `/data/classical-first-read/${encodeURIComponent(lessonId)}.json`;
}

export async function loadClassicalFirstRead(request, env, lessonId) {
  if (!/^lesson-[\w-]{1,60}$/.test(lessonId)) throw new Error("lessonId invalid");
  const url = new URL(firstReadAssetPath(lessonId), request.url);
  const response = await env.ASSETS.fetch(new Request(url.toString(), { method: "GET" }));
  if (!response.ok) throw new Error("classical first-read text unavailable");
  const asset = await response.json();
  if (
    asset?.schema !== FIRST_READ_SCHEMA
    || Number(asset?.schemaVersion) !== 1
    || asset?.offsetUnit !== "utf16_code_unit"
    || asset?.lessonId !== lessonId
    || !/^cfr-lesson-[\w-]+-[a-f0-9]{16}$/.test(String(asset?.textVersionId || ""))
    || !/^sha256:[a-f0-9]{64}$/.test(String(asset?.textDigest || ""))
    || !Array.isArray(asset?.paragraphs)
    || asset.paragraphs.length === 0
  ) {
    throw new Error("classical first-read text contract invalid");
  }
  const keys = new Set();
  for (const paragraph of asset.paragraphs) {
    if (
      !/^cfrp:lesson-[\w-]+:[a-f0-9]{16}:\d{2,4}$/.test(String(paragraph?.key || ""))
      || keys.has(paragraph.key)
      || typeof paragraph?.text !== "string"
      || paragraph.text.length === 0
    ) throw new Error("classical first-read paragraph contract invalid");
    keys.add(paragraph.key);
  }
  return asset;
}

function assertTextVersion(asset, payload) {
  const textVersionId = clean(payload?.textVersionId, 96);
  const textDigest = clean(payload?.textDigest, 96);
  if (textVersionId !== asset.textVersionId || textDigest !== asset.textDigest) {
    const error = new Error("初讀正文已更新，請刷新後重新標記");
    error.code = "first_read_text_version_conflict";
    throw error;
  }
}

async function ensureSession(db, studentId, asset, elapsedMs = 0) {
  const now = isoNow();
  const elapsed = integer(elapsedMs, 0, MAX_ELAPSED_MS) ?? 0;
  await db.prepare(
    `INSERT INTO classical_first_read_sessions (
       student_id, lesson_id, text_version_id, text_digest, elapsed_ms,
       started_at, last_activity_at, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(student_id, lesson_id, text_version_id) DO UPDATE SET
       text_digest = excluded.text_digest,
       elapsed_ms = MAX(classical_first_read_sessions.elapsed_ms, excluded.elapsed_ms),
       last_activity_at = excluded.last_activity_at,
       updated_at = excluded.updated_at
     WHERE classical_first_read_sessions.submitted_at IS NULL`
  ).bind(
    studentId,
    asset.lessonId,
    asset.textVersionId,
    asset.textDigest,
    elapsed,
    now,
    now,
    now,
    now,
  ).run();
}

async function sessionRow(db, studentId, lessonId, textVersionId) {
  return db.prepare(
    `SELECT text_version_id, text_digest, started_at, last_activity_at, elapsed_ms,
            summary_text, submitted_at
       FROM classical_first_read_sessions
      WHERE student_id = ? AND lesson_id = ? AND text_version_id = ?`
  ).bind(studentId, lessonId, textVersionId).first();
}

async function markRows(db, studentId, lessonId, textVersionId) {
  const rows = await db.prepare(
    `SELECT mark_id, paragraph_key, start_offset, end_offset, selected_text,
            context_before, context_after, guess_text, correction_text,
            resolution_status, created_at, updated_at
       FROM classical_first_read_marks
      WHERE student_id = ? AND lesson_id = ? AND text_version_id = ? AND deleted_at IS NULL
      ORDER BY created_at, mark_id`
  ).bind(studentId, lessonId, textVersionId).all();
  return rows.results || [];
}

function publicMark(row) {
  return {
    markId: row.mark_id,
    paragraphKey: row.paragraph_key,
    startOffset: Number(row.start_offset),
    endOffset: Number(row.end_offset),
    selectedText: row.selected_text,
    contextBefore: row.context_before,
    contextAfter: row.context_after,
    guess: row.guess_text,
    correction: row.correction_text,
    resolutionStatus: row.resolution_status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function getClassicalFirstReadState(request, env, student, lessonId) {
  const asset = await loadClassicalFirstRead(request, env, lessonId);
  const session = await sessionRow(env.READING_DB, student.id, lessonId, asset.textVersionId);
  const marks = await markRows(env.READING_DB, student.id, lessonId, asset.textVersionId);
  const resolvedCount = marks.filter((row) => row.resolution_status === "resolved").length;
  return {
    ok: true,
    lessonId,
    textVersionId: asset.textVersionId,
    textDigest: asset.textDigest,
    submitted: Boolean(session?.submitted_at),
    unlocked: Boolean(session?.submitted_at),
    submittedAt: session?.submitted_at || null,
    elapsedMs: Number(session?.elapsed_ms || 0),
    summary: session?.summary_text || "",
    markCount: marks.length,
    resolvedCount,
    resolutionRate: marks.length ? resolvedCount / marks.length : null,
    marks: marks.map(publicMark),
  };
}

export async function upsertClassicalFirstReadMark(request, env, student, payload) {
  const lessonId = clean(payload?.lessonId, 80);
  const asset = await loadClassicalFirstRead(request, env, lessonId);
  assertTextVersion(asset, payload);
  const paragraphKey = clean(payload?.paragraphKey, 96);
  const paragraph = asset.paragraphs.find((item) => item.key === paragraphKey);
  if (!paragraph) throw new Error("初讀段落不存在");
  const startOffset = integer(payload?.startOffset, 0, paragraph.text.length);
  const endOffset = integer(payload?.endOffset, 1, paragraph.text.length);
  if (startOffset === null || endOffset === null || endOffset <= startOffset) {
    throw new Error("初讀標記位置無效");
  }
  const selectedText = paragraph.text.slice(startOffset, endOffset);
  if (!selectedText || [...selectedText].length > MAX_SELECTED_CHARS) {
    throw new Error("初讀標記須為 1 至 120 字");
  }
  if (clean(payload?.selectedText, MAX_SELECTED_CHARS) !== selectedText) {
    throw new Error("初讀標記文字與位置不一致");
  }
  const guess = clean(payload?.guess, MAX_GUESS_CHARS);
  if (!guess) throw new Error("請先寫下第一直覺猜測");
  const clientMutationId = clean(payload?.clientMutationId, 100);
  if (clientMutationId) {
    const replay = await env.READING_DB.prepare(
      `SELECT mark_id, lesson_id, text_version_id, paragraph_key, start_offset, end_offset,
              selected_text, context_before, context_after, guess_text, correction_text,
              resolution_status, created_at, updated_at, deleted_at
         FROM classical_first_read_marks
        WHERE student_id = ? AND client_mutation_id = ?`
    ).bind(student.id, clientMutationId).first();
    if (replay && !replay.deleted_at) {
      const sameMark = replay.lesson_id === lessonId
        && replay.text_version_id === asset.textVersionId
        && replay.paragraph_key === paragraphKey
        && Number(replay.start_offset) === startOffset
        && Number(replay.end_offset) === endOffset
        && replay.selected_text === selectedText;
      if (!sameMark) {
        const error = new Error("本次提交標識已用於另一初讀標記，請刷新後重試");
        error.code = "learning_mutation_conflict";
        throw error;
      }
      return { ok: true, deduped: true, mark: publicMark(replay) };
    }
  }
  const markId = `frm-${(await sha256([
    student.id,
    lessonId,
    asset.textVersionId,
    paragraphKey,
    startOffset,
    endOffset,
    selectedText,
  ].join("\n"))).slice(0, 32)}`;
  const contextBefore = paragraph.text.slice(Math.max(0, startOffset - 24), startOffset);
  const contextAfter = paragraph.text.slice(endOffset, endOffset + 24);
  await ensureSession(env.READING_DB, student.id, asset, payload?.elapsedMs);
  const now = isoNow();
  try {
    const result = await env.READING_DB.prepare(
      `INSERT INTO classical_first_read_marks (
       mark_id, student_id, lesson_id, text_version_id, text_digest,
       paragraph_key, start_offset, end_offset, selected_text,
       context_before, context_after, guess_text, client_mutation_id,
       created_at, updated_at
     ) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
       WHERE EXISTS (
         SELECT 1 FROM classical_first_read_sessions
          WHERE student_id = ? AND lesson_id = ? AND text_version_id = ? AND submitted_at IS NULL
       )
       AND NOT EXISTS (
         SELECT 1 FROM classical_first_read_marks
          WHERE student_id = ? AND lesson_id = ? AND text_version_id = ?
            AND paragraph_key = ? AND deleted_at IS NULL
            AND start_offset < ? AND end_offset > ?
            AND NOT (start_offset = ? AND end_offset = ? AND selected_text = ?)
       )
       AND (
         EXISTS (
           SELECT 1 FROM classical_first_read_marks
            WHERE student_id = ? AND lesson_id = ? AND text_version_id = ?
              AND paragraph_key = ? AND start_offset = ? AND end_offset = ? AND selected_text = ?
              AND deleted_at IS NULL
         )
         OR (
           SELECT COUNT(*) FROM classical_first_read_marks
            WHERE student_id = ? AND lesson_id = ? AND text_version_id = ? AND deleted_at IS NULL
         ) < ?
       )
     ON CONFLICT(student_id, lesson_id, text_version_id, paragraph_key, start_offset, end_offset, selected_text)
     DO UPDATE SET
       guess_text = excluded.guess_text,
       context_before = excluded.context_before,
       context_after = excluded.context_after,
       client_mutation_id = CASE
         WHEN excluded.client_mutation_id != '' THEN excluded.client_mutation_id
         ELSE classical_first_read_marks.client_mutation_id
       END,
       deleted_at = NULL,
       updated_at = excluded.updated_at
     WHERE EXISTS (
       SELECT 1 FROM classical_first_read_sessions
        WHERE student_id = excluded.student_id
          AND lesson_id = excluded.lesson_id
          AND text_version_id = excluded.text_version_id
          AND submitted_at IS NULL
     )`
    ).bind(
      markId,
      student.id,
      lessonId,
      asset.textVersionId,
      asset.textDigest,
      paragraphKey,
      startOffset,
      endOffset,
      selectedText,
      contextBefore,
      contextAfter,
      guess,
      clientMutationId,
      now,
      now,
      student.id,
      lessonId,
      asset.textVersionId,
      student.id,
      lessonId,
      asset.textVersionId,
      paragraphKey,
      endOffset,
      startOffset,
      startOffset,
      endOffset,
      selectedText,
      student.id,
      lessonId,
      asset.textVersionId,
      paragraphKey,
      startOffset,
      endOffset,
      selectedText,
      student.id,
      lessonId,
      asset.textVersionId,
      MAX_MARKS_PER_LESSON,
    ).run();
    if (Number(result.meta?.changes || 0) !== 1) {
      const session = await sessionRow(env.READING_DB, student.id, lessonId, asset.textVersionId);
      if (session?.submitted_at) throw new Error("初讀已提交，原始猜測不可再改寫");
      const overlap = await env.READING_DB.prepare(
        `SELECT mark_id FROM classical_first_read_marks
          WHERE student_id = ? AND lesson_id = ? AND text_version_id = ?
            AND paragraph_key = ? AND deleted_at IS NULL
            AND start_offset < ? AND end_offset > ?
            AND NOT (start_offset = ? AND end_offset = ? AND selected_text = ?)
          LIMIT 1`
      ).bind(
        student.id,
        lessonId,
        asset.textVersionId,
        paragraphKey,
        endOffset,
        startOffset,
        startOffset,
        endOffset,
        selectedText,
      ).first();
      if (overlap) throw new Error("初讀疑難標記不可與既有標記重疊");
      throw new Error("本課初讀標記已達上限");
    }
  } catch (error) {
    if (!clientMutationId || !String(error?.message || "").toLowerCase().includes("constraint")) throw error;
    const replay = await env.READING_DB.prepare(
      `SELECT mark_id, lesson_id, text_version_id, paragraph_key, start_offset, end_offset,
              selected_text, context_before, context_after, guess_text, correction_text,
              resolution_status, created_at, updated_at, deleted_at
         FROM classical_first_read_marks
        WHERE student_id = ? AND client_mutation_id = ?`
    ).bind(student.id, clientMutationId).first();
    const sameMark = replay
      && replay.lesson_id === lessonId
      && replay.text_version_id === asset.textVersionId
      && replay.paragraph_key === paragraphKey
      && Number(replay.start_offset) === startOffset
      && Number(replay.end_offset) === endOffset
      && replay.selected_text === selectedText;
    if (!sameMark) {
      const conflict = new Error("本次提交標識已用於另一初讀標記，請刷新後重試");
      conflict.code = "learning_mutation_conflict";
      throw conflict;
    }
    return { ok: true, deduped: true, mark: publicMark(replay) };
  }
  const row = await env.READING_DB.prepare(
    `SELECT mark_id, paragraph_key, start_offset, end_offset, selected_text,
            context_before, context_after, guess_text, correction_text,
            resolution_status, created_at, updated_at
       FROM classical_first_read_marks WHERE mark_id = ?`
  ).bind(markId).first();
  return { ok: true, mark: publicMark(row) };
}

export async function deleteClassicalFirstReadMark(request, env, student, payload) {
  const lessonId = clean(payload?.lessonId, 80);
  const asset = await loadClassicalFirstRead(request, env, lessonId);
  assertTextVersion(asset, payload);
  const session = await sessionRow(env.READING_DB, student.id, lessonId, asset.textVersionId);
  if (session?.submitted_at) throw new Error("初讀已提交，原始標記不可刪除");
  const markId = clean(payload?.markId, 80);
  const now = isoNow();
  const result = await env.READING_DB.prepare(
    `UPDATE classical_first_read_marks
        SET deleted_at = ?, updated_at = ?
      WHERE mark_id = ? AND student_id = ? AND lesson_id = ? AND text_version_id = ? AND deleted_at IS NULL
        AND EXISTS (
          SELECT 1 FROM classical_first_read_sessions
           WHERE student_id = ? AND lesson_id = ? AND text_version_id = ? AND submitted_at IS NULL
        )`
  ).bind(
    now,
    now,
    markId,
    student.id,
    lessonId,
    asset.textVersionId,
    student.id,
    lessonId,
    asset.textVersionId,
  ).run();
  if (Number(result.meta?.changes || 0) !== 1) {
    const current = await sessionRow(env.READING_DB, student.id, lessonId, asset.textVersionId);
    if (current?.submitted_at) throw new Error("初讀已提交，原始標記不可刪除");
  }
  return { ok: true, deleted: Number(result.meta?.changes || 0) === 1 };
}

export async function submitClassicalFirstRead(request, env, student, payload) {
  const lessonId = clean(payload?.lessonId, 80);
  const asset = await loadClassicalFirstRead(request, env, lessonId);
  assertTextVersion(asset, payload);
  await ensureSession(env.READING_DB, student.id, asset, payload?.elapsedMs);
  const summary = clean(payload?.summary, MAX_SUMMARY_CHARS);
  if ([...summary].length < 12) throw new Error("初讀感知至少 12 字");
  const now = isoNow();
  const result = await env.READING_DB.prepare(
    `UPDATE classical_first_read_sessions
        SET summary_text = ?, submitted_at = ?,
            last_activity_at = ?, updated_at = ?,
            elapsed_ms = MAX(elapsed_ms, ?)
      WHERE student_id = ? AND lesson_id = ? AND text_version_id = ?
        AND submitted_at IS NULL
        AND (
          SELECT COUNT(*) FROM classical_first_read_marks
           WHERE student_id = ? AND lesson_id = ? AND text_version_id = ?
             AND deleted_at IS NULL AND TRIM(guess_text) != ''
        ) >= 3
        AND NOT EXISTS (
          SELECT 1
            FROM classical_first_read_marks AS first_mark
            JOIN classical_first_read_marks AS second_mark
              ON second_mark.student_id = first_mark.student_id
             AND second_mark.lesson_id = first_mark.lesson_id
             AND second_mark.text_version_id = first_mark.text_version_id
             AND second_mark.paragraph_key = first_mark.paragraph_key
             AND second_mark.mark_id > first_mark.mark_id
             AND second_mark.start_offset < first_mark.end_offset
             AND second_mark.end_offset > first_mark.start_offset
           WHERE first_mark.student_id = ?
             AND first_mark.lesson_id = ?
             AND first_mark.text_version_id = ?
             AND first_mark.deleted_at IS NULL
             AND second_mark.deleted_at IS NULL
        )`
  ).bind(
    summary,
    now,
    now,
    now,
    integer(payload?.elapsedMs, 0, MAX_ELAPSED_MS) ?? 0,
    student.id,
    lessonId,
    asset.textVersionId,
    student.id,
    lessonId,
    asset.textVersionId,
    student.id,
    lessonId,
    asset.textVersionId,
  ).run();
  const session = await sessionRow(env.READING_DB, student.id, lessonId, asset.textVersionId);
  const deduped = Number(result.meta?.changes || 0) !== 1;
  if (deduped && !session?.submitted_at) {
    throw new Error("至少完成 3 處互不重疊的疑難標記與第一直覺猜測");
  }
  const marks = await markRows(env.READING_DB, student.id, lessonId, asset.textVersionId);
  return {
    ok: true,
    deduped,
    lessonId,
    textVersionId: asset.textVersionId,
    submittedAt: session.submitted_at,
    markCount: marks.length,
    elapsedMs: Number(session.elapsed_ms || 0),
  };
}

export async function resolveClassicalFirstReadMark(request, env, student, payload) {
  const lessonId = clean(payload?.lessonId, 80);
  const asset = await loadClassicalFirstRead(request, env, lessonId);
  assertTextVersion(asset, payload);
  const session = await sessionRow(env.READING_DB, student.id, lessonId, asset.textVersionId);
  if (!session?.submitted_at) throw new Error("請先提交無標點初讀");
  const markId = clean(payload?.markId, 80);
  const correction = clean(payload?.correction, MAX_CORRECTION_CHARS);
  if (!correction) throw new Error("請寫下對照註釋後的訂正");
  const now = isoNow();
  const result = await env.READING_DB.prepare(
    `UPDATE classical_first_read_marks
        SET correction_text = ?, resolution_status = 'resolved', updated_at = ?
      WHERE mark_id = ? AND student_id = ? AND lesson_id = ?
        AND text_version_id = ? AND deleted_at IS NULL`
  ).bind(correction, now, markId, student.id, lessonId, asset.textVersionId).run();
  if (Number(result.meta?.changes || 0) !== 1) throw new Error("初讀標記不存在");
  const marks = await markRows(env.READING_DB, student.id, lessonId, asset.textVersionId);
  const resolvedCount = marks.filter((row) => row.resolution_status === "resolved").length;
  return {
    ok: true,
    markCount: marks.length,
    resolvedCount,
    allResolved: marks.length > 0 && resolvedCount === marks.length,
  };
}

export const classicalFirstReadContract = Object.freeze({
  schemaVersion: FIRST_READ_SCHEMA,
  minimumMarks: 3,
  minimumSummaryChars: 12,
  maxSelectedChars: MAX_SELECTED_CHARS,
});
