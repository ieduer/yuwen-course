import {
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right, "en"))
        .map(([key, item]) => [key, canonicalize(item)]),
    );
  }
  return value;
}

function sameCanonicalValue(left, right) {
  return JSON.stringify(canonicalize(left)) === JSON.stringify(canonicalize(right));
}

export function auditReceiptIssues(receipt, { semanticDigest, counts }) {
  const issues = [];
  if (receipt?.schemaVersion !== "yw-native-content-audit-receipt-v1") {
    issues.push("audit receipt schema is not yw-native-content-audit-receipt-v1");
  }
  if (receipt?.siteKey !== "yw") {
    issues.push("audit receipt siteKey is not yw");
  }
  if (receipt?.reviewDisposition !== "approved") {
    issues.push("audit receipt is not approved");
  }
  if (receipt?.semanticDigest !== semanticDigest) {
    issues.push("audit receipt semanticDigest differs from the canonical graph");
  }
  if (!sameCanonicalValue(receipt?.counts, counts)) {
    issues.push("audit receipt counts differ from the canonical graph");
  }
  return issues;
}

export function writeImmutableFile(file, body) {
  const expected = Buffer.isBuffer(body) ? body : Buffer.from(body);
  mkdirSync(path.dirname(file), { recursive: true });
  try {
    writeFileSync(file, expected, { flag: "wx" });
    return "written";
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
  }
  const existing = readFileSync(file);
  if (!existing.equals(expected)) {
    throw new Error(`immutable path already exists with different bytes: ${file}`);
  }
  return "unchanged";
}
