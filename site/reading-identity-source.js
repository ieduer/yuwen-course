function cleanIdentityText(value, max = 80) {
  return String(value || "").trim().slice(0, max);
}

function validUserId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function identityConflict(message = "verified User Center identity conflicts with reading history") {
  const error = new Error(message);
  error.code = "reading_identity_conflict";
  return error;
}

export function readingIdentityDecision(exactRow, slugRow, user) {
  const userId = validUserId(user?.userId);
  const slug = cleanIdentityText(user?.slug);
  if (!userId || !slug) return { action: "reject" };
  if (exactRow) {
    if (slugRow && Number(slugRow.id) !== Number(exactRow.id)) return { action: "conflict" };
    return { action: exactRow.uc_slug === slug ? "refresh" : "rename", studentId: Number(exactRow.id) };
  }
  if (!slugRow) return { action: "create" };
  if (validUserId(slugRow.uc_user_id) === userId) return { action: "refresh", studentId: Number(slugRow.id) };
  if (slugRow.uc_user_id === null || slugRow.uc_user_id === undefined) {
    return { action: "link_legacy", studentId: Number(slugRow.id) };
  }
  return { action: "conflict" };
}

async function selectByUserId(db, userId) {
  return db.prepare(
    "SELECT id, uc_user_id, uc_slug, display_name, class_name FROM students WHERE uc_user_id = ? LIMIT 1",
  ).bind(userId).first();
}

async function selectBySlug(db, slug) {
  return db.prepare(
    "SELECT id, uc_user_id, uc_slug, display_name, class_name FROM students WHERE uc_slug = ? LIMIT 1",
  ).bind(slug).first();
}

export async function reconcileReadingStudent(db, user, now = new Date().toISOString()) {
  const userId = validUserId(user?.userId);
  const slug = cleanIdentityText(user?.slug);
  const displayName = cleanIdentityText(user?.displayName);
  if (!db || !userId || !slug) throw identityConflict("stable User Center identity required");

  let exactRow = await selectByUserId(db, userId);
  let slugRow = await selectBySlug(db, slug);
  let decision = readingIdentityDecision(exactRow, slugRow, { userId, slug });
  if (decision.action === "reject" || decision.action === "conflict") throw identityConflict();

  if (decision.action === "create") {
    await db.prepare(
      `INSERT OR IGNORE INTO students
       (uc_user_id, uc_slug, display_name, identity_verified_at)
       VALUES (?, ?, ?, ?)`,
    ).bind(userId, slug, displayName, now).run();
  } else if (decision.action === "link_legacy") {
    const legacyStudentId = decision.studentId;
    await db.batch([
      db.prepare(
        `UPDATE students SET uc_user_id = ?, display_name = ?, identity_verified_at = ?,
           last_seen_at = datetime('now')
         WHERE id = ? AND uc_user_id IS NULL AND uc_slug = ?`,
      ).bind(userId, displayName || slugRow.display_name, now, legacyStudentId, slug),
      db.prepare(
        `INSERT OR IGNORE INTO student_identity_links
         (student_id, uc_user_id, verified_slug, verification_source, linked_at)
         SELECT id, ?, ?, 'user_center_service_binding', ? FROM students
         WHERE id = ? AND uc_user_id = ?`,
      ).bind(userId, slug, now, legacyStudentId, userId),
    ]);
  } else {
    await db.prepare(
      `UPDATE students SET uc_slug = ?, display_name = ?, identity_verified_at = ?,
         last_seen_at = datetime('now')
       WHERE id = ? AND uc_user_id = ?`,
    ).bind(slug, displayName || exactRow.display_name, now, decision.studentId, userId).run();
  }

  exactRow = await selectByUserId(db, userId);
  slugRow = await selectBySlug(db, slug);
  decision = readingIdentityDecision(exactRow, slugRow, { userId, slug });
  if (!exactRow || decision.action === "conflict" || Number(slugRow?.id) !== Number(exactRow.id)) {
    throw identityConflict();
  }
  return {
    id: Number(exactRow.id),
    ucUserId: userId,
    slug: exactRow.uc_slug,
    displayName: displayName || exactRow.display_name,
    className: exactRow.class_name || "",
  };
}
