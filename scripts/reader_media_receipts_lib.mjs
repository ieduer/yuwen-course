import { createHash } from 'node:crypto';
import {
  existsSync,
  readFileSync,
  readdirSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));

export const REPO_ROOT = resolve(SCRIPT_DIR, '..');
export const RECEIPT_SCHEMA_VERSION = 'yw-reader-media-receipts-v1';
export const ANOMALY_SCHEMA_VERSION = 'yw-reader-media-receipt-anomalies-v1';
export const DEFAULT_LEDGER_VERSION = '2026-07-30.1';
export const RIGHTS_BASIS = 'user-authorized-course-source-use-2026-07-29';
export const DEFAULT_ALLOWED_HOSTS = new Set([
  'files.rdfzer.com',
  'forum.rdfzer.com',
]);
export const DEFAULT_MAX_OBJECT_BYTES = 12 * 1024 * 1024;
export const DEFAULT_MAX_TOTAL_BYTES = 384 * 1024 * 1024;
export const DEFAULT_TIMEOUT_MS = 20_000;
export const DEFAULT_MAX_REDIRECTS = 3;

export const REQUIRED_MEDIA_TARGETS = Object.freeze([
  Object.freeze({
    lessonId: 'lesson-1557',
    role: 'primary',
    postNumber: 1,
    sourceUrl:
      'https://files.rdfzer.com/original/2X/b/bdfbe13294db151cbe5b180495493a0a46181138.jpeg',
  }),
]);

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
]);

export class ReceiptCollectionError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'ReceiptCollectionError';
    this.code = code;
    this.details = details;
  }
}

export function sha256Hex(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function canonicalJson(value) {
  return JSON.stringify(sortObject(value));
}

export function prettyJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function sortObject(value) {
  if (Array.isArray(value)) return value.map(sortObject);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortObject(value[key])]),
  );
}

export function canonicalHttpsUrl(rawUrl, allowedHosts = DEFAULT_ALLOWED_HOSTS) {
  let url;
  try {
    url = new URL(String(rawUrl || '').trim());
  } catch {
    throw new ReceiptCollectionError(
      'invalid-url',
      `invalid media URL: ${String(rawUrl || '')}`,
    );
  }

  if (url.protocol !== 'https:') {
    throw new ReceiptCollectionError(
      'non-https-url',
      `media URL must use HTTPS: ${url.href}`,
    );
  }
  if (url.username || url.password) {
    throw new ReceiptCollectionError(
      'url-credentials',
      `media URL must not contain credentials: ${url.href}`,
    );
  }
  if (url.port && url.port !== '443') {
    throw new ReceiptCollectionError(
      'unexpected-port',
      `media URL must use the default HTTPS port: ${url.href}`,
    );
  }

  const hostname = url.hostname.toLowerCase();
  if (!allowedHosts.has(hostname)) {
    throw new ReceiptCollectionError(
      'host-not-allowed',
      `media host is not allowlisted: ${hostname}`,
      { hostname },
    );
  }

  url.hostname = hostname;
  url.hash = '';
  return url.href;
}

function mediaUrl(media) {
  return media?.sourceUrl || media?.src || media?.href || '';
}

function postNumberOf(value) {
  const candidate =
    value?.postNumber ??
    value?.sourcePostNumber ??
    value?.post_number ??
    null;
  return Number.isInteger(Number(candidate)) ? Number(candidate) : null;
}

function sortedUses(uses) {
  return [...uses].sort((left, right) => {
    return (
      left.lessonId.localeCompare(right.lessonId) ||
      left.role.localeCompare(right.role) ||
      (left.postNumber ?? -1) - (right.postNumber ?? -1)
    );
  });
}

function addTarget(targetMap, issues, candidate, allowedHosts) {
  const rawUrl = String(candidate.sourceUrl || '').trim();
  if (!rawUrl) return;

  let sourceUrl;
  try {
    sourceUrl = canonicalHttpsUrl(rawUrl, allowedHosts);
  } catch (error) {
    issues.push({
      code: error.code || 'invalid-source-url',
      lessonId: candidate.lessonId,
      role: candidate.role,
      sourceUrl: rawUrl,
      message: error.message,
    });
    return;
  }

  const use = {
    lessonId: candidate.lessonId,
    role: candidate.role,
    ...(candidate.postNumber == null
      ? {}
      : { postNumber: candidate.postNumber }),
  };
  const useKey = canonicalJson(use);
  const current = targetMap.get(sourceUrl) || new Map();
  current.set(useKey, use);
  targetMap.set(sourceUrl, current);
}

function sourceLessonImages(lesson, allowedPostRoles) {
  const images = [];
  for (const image of lesson?.forumImages || []) {
    const postNumber = postNumberOf(image);
    const role = allowedPostRoles.get(postNumber);
    if (!role) continue;
    images.push({
      role,
      postNumber,
      sourceUrl: mediaUrl(image),
    });
  }

  for (const post of lesson?.posts || []) {
    const postNumber = postNumberOf(post);
    const role = allowedPostRoles.get(postNumber);
    if (!role) continue;
    for (const image of post?.images || []) {
      images.push({
        role,
        postNumber,
        sourceUrl: mediaUrl(image),
      });
    }
  }
  return images;
}

export function extractReaderMediaTargets({
  repoRoot = REPO_ROOT,
  readerDocumentsDir = resolve(repoRoot, 'site/data/reader-documents'),
  lessonsDir = resolve(repoRoot, 'site/data/lessons'),
  allowedHosts = DEFAULT_ALLOWED_HOSTS,
} = {}) {
  const targetMap = new Map();
  const issues = [];
  let readerSemanticDigest = null;
  const readerIndexPath = resolve(readerDocumentsDir, 'index.json');
  if (!existsSync(readerIndexPath)) {
    issues.push({
      code: 'reader-index-missing',
      message: `reader document index is missing: ${readerIndexPath}`,
    });
  } else {
    try {
      const readerIndex = JSON.parse(readFileSync(readerIndexPath, 'utf8'));
      readerSemanticDigest = readerIndex.readerSemanticDigest;
      if (
        typeof readerSemanticDigest !== 'string' ||
        !/^sha256:[a-f0-9]{64}$/.test(readerSemanticDigest)
      ) {
        issues.push({
          code: 'reader-semantic-digest-invalid',
          message: 'reader document index has no valid semantic digest',
        });
      }
    } catch (error) {
      issues.push({
        code: 'reader-index-invalid',
        message: `${readerIndexPath}: ${error.message}`,
      });
    }
  }
  const readerFiles = existsSync(readerDocumentsDir)
    ? readdirSync(readerDocumentsDir)
        .filter((file) => /^lesson-.+\.json$/.test(file))
        .sort()
    : [];

  if (readerFiles.length === 0) {
    issues.push({
      code: 'reader-documents-missing',
      message: `no reader documents found in ${readerDocumentsDir}`,
    });
  }

  for (const file of readerFiles) {
    let document;
    try {
      document = JSON.parse(
        readFileSync(resolve(readerDocumentsDir, file), 'utf8'),
      );
    } catch (error) {
      issues.push({
        code: 'reader-document-invalid',
        message: `${file}: ${error.message}`,
      });
      continue;
    }

    const lessonId = String(document.lessonId || file.replace(/\.json$/, ''));
    const postRoles = new Map(
      (document?.provenance?.posts || [])
        .filter((post) =>
          ['primary', 'supplementary'].includes(String(post.role || '')),
        )
        .map((post) => [postNumberOf(post), post.role]),
    );

    for (const media of document?.provenance?.media || []) {
      if (!['primary', 'supplementary'].includes(media?.postRole)) continue;
      addTarget(
        targetMap,
        issues,
        {
          lessonId,
          role: media.postRole,
          postNumber: postNumberOf(media),
          sourceUrl: mediaUrl(media),
        },
        allowedHosts,
      );
    }

    for (const media of document?.main?.media || []) {
      addTarget(
        targetMap,
        issues,
        {
          lessonId,
          role: 'primary',
          postNumber: postNumberOf(document.main),
          sourceUrl: mediaUrl(media),
        },
        allowedHosts,
      );
    }

    for (const supplement of document?.supplementary || []) {
      for (const media of supplement?.media || []) {
        addTarget(
          targetMap,
          issues,
          {
            lessonId,
            role: 'supplementary',
            postNumber: postNumberOf(supplement),
            sourceUrl: mediaUrl(media),
          },
          allowedHosts,
        );
      }
    }

    const lessonPath = resolve(lessonsDir, `${lessonId}.json`);
    if (!existsSync(lessonPath)) {
      issues.push({
        code: 'source-lesson-missing',
        lessonId,
        message: `source lesson is missing: ${lessonPath}`,
      });
      continue;
    }
    try {
      const lesson = JSON.parse(readFileSync(lessonPath, 'utf8'));
      for (const image of sourceLessonImages(lesson, postRoles)) {
        addTarget(
          targetMap,
          issues,
          { lessonId, ...image },
          allowedHosts,
        );
      }
    } catch (error) {
      issues.push({
        code: 'source-lesson-invalid',
        lessonId,
        message: `${lessonPath}: ${error.message}`,
      });
    }
  }

  for (const required of REQUIRED_MEDIA_TARGETS) {
    addTarget(targetMap, issues, required, allowedHosts);
  }

  const targets = [...targetMap.entries()]
    .map(([sourceUrl, uses]) => ({
      sourceUrl,
      uses: sortedUses(uses.values()),
    }))
    .sort((left, right) => left.sourceUrl.localeCompare(right.sourceUrl));
  const inventorySha256 = sha256Hex(canonicalJson(targets));

  return {
    schemaVersion: 'yw-reader-media-target-inventory-v1',
    readerSemanticDigest,
    inventorySha256,
    targetCount: targets.length,
    targets,
    issues: issues.sort(
      (left, right) =>
        String(left.sourceUrl || '').localeCompare(
          String(right.sourceUrl || ''),
        ) ||
        String(left.lessonId || '').localeCompare(
          String(right.lessonId || ''),
        ) ||
        String(left.code || '').localeCompare(String(right.code || '')),
    ),
  };
}

function uint24Le(buffer, offset) {
  return (
    buffer[offset] |
    (buffer[offset + 1] << 8) |
    (buffer[offset + 2] << 16)
  );
}

function jpegDimensions(buffer) {
  let offset = 2;
  while (offset + 4 <= buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    while (buffer[offset] === 0xff) offset += 1;
    const marker = buffer[offset];
    offset += 1;
    if (marker === 0xd8 || marker === 0xd9) continue;
    if (marker === 0xda) break;
    if (offset + 2 > buffer.length) break;
    const segmentLength = buffer.readUInt16BE(offset);
    if (segmentLength < 2 || offset + segmentLength > buffer.length) break;
    if (
      [
        0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb,
        0xcd, 0xce, 0xcf,
      ].includes(marker)
    ) {
      if (segmentLength < 7) break;
      return {
        width: buffer.readUInt16BE(offset + 5),
        height: buffer.readUInt16BE(offset + 3),
      };
    }
    offset += segmentLength;
  }
  throw new ReceiptCollectionError(
    'invalid-image-dimensions',
    'JPEG dimensions could not be decoded',
  );
}

function webpDimensions(buffer) {
  let offset = 12;
  while (offset + 8 <= buffer.length) {
    const chunkType = buffer.toString('ascii', offset, offset + 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);
    const dataOffset = offset + 8;
    if (dataOffset + chunkSize > buffer.length) break;

    if (chunkType === 'VP8X' && chunkSize >= 10) {
      return {
        width: uint24Le(buffer, dataOffset + 4) + 1,
        height: uint24Le(buffer, dataOffset + 7) + 1,
      };
    }
    if (
      chunkType === 'VP8 ' &&
      chunkSize >= 10 &&
      buffer[dataOffset + 3] === 0x9d &&
      buffer[dataOffset + 4] === 0x01 &&
      buffer[dataOffset + 5] === 0x2a
    ) {
      return {
        width: buffer.readUInt16LE(dataOffset + 6) & 0x3fff,
        height: buffer.readUInt16LE(dataOffset + 8) & 0x3fff,
      };
    }
    if (
      chunkType === 'VP8L' &&
      chunkSize >= 5 &&
      buffer[dataOffset] === 0x2f
    ) {
      const packed = buffer.readUInt32LE(dataOffset + 1);
      return {
        width: (packed & 0x3fff) + 1,
        height: ((packed >> 14) & 0x3fff) + 1,
      };
    }
    offset = dataOffset + chunkSize + (chunkSize % 2);
  }
  throw new ReceiptCollectionError(
    'invalid-image-dimensions',
    'WebP dimensions could not be decoded',
  );
}

export function inspectImage(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) {
    throw new ReceiptCollectionError(
      'invalid-image',
      'downloaded media is too short to be an image',
    );
  }

  let mime;
  let dimensions;
  if (
    buffer.subarray(0, 8).equals(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    )
  ) {
    if (buffer.length < 24 || buffer.toString('ascii', 12, 16) !== 'IHDR') {
      throw new ReceiptCollectionError(
        'invalid-image',
        'PNG is missing its IHDR dimensions',
      );
    }
    mime = 'image/png';
    dimensions = {
      width: buffer.readUInt32BE(16),
      height: buffer.readUInt32BE(20),
    };
  } else if (buffer[0] === 0xff && buffer[1] === 0xd8) {
    mime = 'image/jpeg';
    dimensions = jpegDimensions(buffer);
  } else if (
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  ) {
    mime = 'image/webp';
    dimensions = webpDimensions(buffer);
  } else {
    throw new ReceiptCollectionError(
      'unsupported-image',
      'downloaded media is not a supported JPEG, PNG, or WebP image',
    );
  }

  if (
    !Number.isInteger(dimensions.width) ||
    !Number.isInteger(dimensions.height) ||
    dimensions.width <= 0 ||
    dimensions.height <= 0
  ) {
    throw new ReceiptCollectionError(
      'invalid-image-dimensions',
      `invalid ${mime} dimensions`,
    );
  }
  return { mime, ...dimensions };
}

function normalizedContentType(response) {
  return String(response.headers.get('content-type') || '')
    .split(';', 1)[0]
    .trim()
    .toLowerCase();
}

async function readBoundedBody(response, maxObjectBytes) {
  const contentLength = Number(response.headers.get('content-length'));
  if (
    Number.isFinite(contentLength) &&
    contentLength > maxObjectBytes
  ) {
    throw new ReceiptCollectionError(
      'oversized-content-length',
      `media declares ${contentLength} bytes, above ${maxObjectBytes}`,
      { bytes: contentLength, maxObjectBytes },
    );
  }
  if (!response.body) {
    throw new ReceiptCollectionError(
      'empty-response-body',
      'media response has no body',
    );
  }

  const chunks = [];
  let bytes = 0;
  for await (const chunk of response.body) {
    const buffer = Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > maxObjectBytes) {
      throw new ReceiptCollectionError(
        'oversized-body',
        `media exceeded ${maxObjectBytes} bytes while downloading`,
        { bytes, maxObjectBytes },
      );
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks, bytes);
}

export async function fetchImageReceipt({
  sourceUrl,
  fetchImpl = globalThis.fetch,
  allowedHosts = DEFAULT_ALLOWED_HOSTS,
  maxObjectBytes = DEFAULT_MAX_OBJECT_BYTES,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxRedirects = DEFAULT_MAX_REDIRECTS,
}) {
  if (typeof fetchImpl !== 'function') {
    throw new ReceiptCollectionError(
      'fetch-unavailable',
      'a fetch implementation is required',
    );
  }

  const canonicalSourceUrl = canonicalHttpsUrl(sourceUrl, allowedHosts);
  let currentUrl = canonicalSourceUrl;
  const redirects = [];

  for (let attempt = 0; attempt <= maxRedirects; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    try {
      response = await fetchImpl(currentUrl, {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          accept: 'image/avif,image/webp,image/png,image/jpeg;q=0.9,*/*;q=0.1',
          'user-agent':
            'YWReaderMediaReceiptCollector/1.0 (+https://yw.bdfz.net/)',
        },
      });
    } catch (error) {
      const code =
        error?.name === 'AbortError' ? 'request-timeout' : 'request-failed';
      throw new ReceiptCollectionError(
        code,
        `${currentUrl}: ${error.message}`,
      );
    } finally {
      clearTimeout(timer);
    }

    if (REDIRECT_STATUSES.has(response.status)) {
      if (attempt === maxRedirects) {
        throw new ReceiptCollectionError(
          'too-many-redirects',
          `media exceeded ${maxRedirects} redirects`,
        );
      }
      const location = response.headers.get('location');
      if (!location) {
        throw new ReceiptCollectionError(
          'redirect-without-location',
          `${currentUrl} returned ${response.status} without Location`,
        );
      }
      let nextUrl;
      try {
        nextUrl = canonicalHttpsUrl(
          new URL(location, currentUrl).href,
          allowedHosts,
        );
      } catch (error) {
        throw new ReceiptCollectionError(
          'unsafe-redirect',
          `${currentUrl} returned an unsafe redirect: ${error.message}`,
        );
      }
      if (redirects.includes(nextUrl) || nextUrl === currentUrl) {
        throw new ReceiptCollectionError(
          'redirect-loop',
          `media redirect loop detected at ${nextUrl}`,
        );
      }
      redirects.push(nextUrl);
      currentUrl = nextUrl;
      continue;
    }

    if (response.status !== 200) {
      throw new ReceiptCollectionError(
        'http-status',
        `${currentUrl} returned HTTP ${response.status}`,
        { status: response.status },
      );
    }

    const headerMime = normalizedContentType(response);
    if (!ALLOWED_MIME_TYPES.has(headerMime)) {
      throw new ReceiptCollectionError(
        'invalid-content-type',
        `${currentUrl} returned ${headerMime || 'no Content-Type'}`,
      );
    }
    const body = await readBoundedBody(response, maxObjectBytes);
    const inspected = inspectImage(body);
    if (headerMime !== inspected.mime) {
      throw new ReceiptCollectionError(
        'mime-mismatch',
        `${currentUrl} declared ${headerMime} but bytes are ${inspected.mime}`,
      );
    }

    return {
      sourceUrl: canonicalSourceUrl,
      finalUrl: currentUrl,
      bytes: body.length,
      sha256: sha256Hex(body),
      mime: inspected.mime,
      width: inspected.width,
      height: inspected.height,
      redirects,
    };
  }

  throw new ReceiptCollectionError(
    'unreachable',
    `failed to collect ${canonicalSourceUrl}`,
  );
}

function sameUses(left, right) {
  return canonicalJson(left || []) === canonicalJson(right || []);
}

function validateReceipt(receipt, target, allowedHosts, maxObjectBytes) {
  const errors = [];
  const requiredStringFields = [
    'sourceUrl',
    'finalUrl',
    'sha256',
    'mime',
    'collectedAt',
    'rightsBasis',
  ];
  for (const field of requiredStringFields) {
    if (typeof receipt?.[field] !== 'string' || !receipt[field]) {
      errors.push(`${target.sourceUrl}: missing ${field}`);
    }
  }

  if (receipt?.sourceUrl !== target.sourceUrl) {
    errors.push(`${target.sourceUrl}: sourceUrl mismatch`);
  }
  try {
    if (receipt?.sourceUrl) canonicalHttpsUrl(receipt.sourceUrl, allowedHosts);
    if (receipt?.finalUrl) canonicalHttpsUrl(receipt.finalUrl, allowedHosts);
  } catch (error) {
    errors.push(`${target.sourceUrl}: ${error.message}`);
  }
  if (
    !Number.isInteger(receipt?.bytes) ||
    receipt.bytes <= 0 ||
    receipt.bytes > maxObjectBytes
  ) {
    errors.push(`${target.sourceUrl}: invalid bytes`);
  }
  if (!/^[a-f0-9]{64}$/.test(String(receipt?.sha256 || ''))) {
    errors.push(`${target.sourceUrl}: invalid sha256`);
  }
  if (!ALLOWED_MIME_TYPES.has(receipt?.mime)) {
    errors.push(`${target.sourceUrl}: invalid MIME`);
  }
  if (
    !Number.isInteger(receipt?.width) ||
    receipt.width <= 0 ||
    !Number.isInteger(receipt?.height) ||
    receipt.height <= 0
  ) {
    errors.push(`${target.sourceUrl}: invalid dimensions`);
  }
  if (
    typeof receipt?.collectedAt !== 'string' ||
    !Number.isFinite(Date.parse(receipt.collectedAt))
  ) {
    errors.push(`${target.sourceUrl}: invalid collectedAt`);
  }
  if (receipt?.rightsBasis !== RIGHTS_BASIS) {
    errors.push(`${target.sourceUrl}: rights basis mismatch`);
  }
  if (!sameUses(receipt?.uses, target.uses)) {
    errors.push(`${target.sourceUrl}: uses mismatch`);
  }
  if (!Array.isArray(receipt?.redirects)) {
    errors.push(`${target.sourceUrl}: redirects must be an array`);
  } else {
    if (receipt.redirects.length > DEFAULT_MAX_REDIRECTS) {
      errors.push(`${target.sourceUrl}: too many recorded redirects`);
    }
    for (const redirect of receipt.redirects) {
      try {
        canonicalHttpsUrl(redirect, allowedHosts);
      } catch (error) {
        errors.push(`${target.sourceUrl}: unsafe redirect: ${error.message}`);
      }
    }
    if (
      receipt.redirects.length > 0 &&
      receipt.redirects.at(-1) !== receipt.finalUrl
    ) {
      errors.push(`${target.sourceUrl}: redirect final URL mismatch`);
    }
    if (
      receipt.redirects.length === 0 &&
      receipt.finalUrl !== receipt.sourceUrl
    ) {
      errors.push(`${target.sourceUrl}: unexplained final URL change`);
    }
  }
  return errors;
}

export function validateReceiptLedger({
  ledger,
  inventory,
  anomalyReport,
  allowedHosts = DEFAULT_ALLOWED_HOSTS,
  maxObjectBytes = DEFAULT_MAX_OBJECT_BYTES,
}) {
  const errors = [];
  if (ledger?.schemaVersion !== RECEIPT_SCHEMA_VERSION) {
    errors.push('receipt ledger schemaVersion mismatch');
  }
  if (
    typeof ledger?.ledgerVersion !== 'string' ||
    !ledger.ledgerVersion.trim()
  ) {
    errors.push('receipt ledger ledgerVersion is required');
  }
  if (ledger?.rightsBasis !== RIGHTS_BASIS) {
    errors.push('receipt ledger rightsBasis mismatch');
  }
  if (ledger?.sourceInventorySha256 !== inventory.inventorySha256) {
    errors.push('receipt ledger source inventory digest is stale');
  }
  if (ledger?.readerSemanticDigest !== inventory.readerSemanticDigest) {
    errors.push('receipt ledger reader semantic digest is stale');
  }
  if (ledger?.receiptCount !== inventory.targetCount) {
    errors.push('receipt ledger count does not match target inventory');
  }
  if (!Array.isArray(ledger?.receipts)) {
    errors.push('receipt ledger receipts must be an array');
  }

  const receipts = Array.isArray(ledger?.receipts) ? ledger.receipts : [];
  const computedTotalBytes = receipts.reduce(
    (sum, receipt) =>
      sum + (Number.isInteger(receipt?.bytes) ? receipt.bytes : 0),
    0,
  );
  if (ledger?.totalBytes !== computedTotalBytes) {
    errors.push('receipt ledger totalBytes mismatch');
  }
  const sortedSourceUrls = receipts
    .map((receipt) => receipt?.sourceUrl || '')
    .sort((left, right) => left.localeCompare(right));
  if (
    canonicalJson(receipts.map((receipt) => receipt?.sourceUrl || '')) !==
    canonicalJson(sortedSourceUrls)
  ) {
    errors.push('receipt ledger must be sorted by sourceUrl');
  }

  const receiptMap = new Map();
  for (const receipt of receipts) {
    if (receiptMap.has(receipt?.sourceUrl)) {
      errors.push(`duplicate receipt: ${receipt?.sourceUrl}`);
      continue;
    }
    receiptMap.set(receipt?.sourceUrl, receipt);
  }
  for (const target of inventory.targets) {
    const receipt = receiptMap.get(target.sourceUrl);
    if (!receipt) {
      errors.push(`missing receipt: ${target.sourceUrl}`);
      continue;
    }
    errors.push(
      ...validateReceipt(receipt, target, allowedHosts, maxObjectBytes),
    );
  }
  for (const sourceUrl of receiptMap.keys()) {
    if (!inventory.targets.some((target) => target.sourceUrl === sourceUrl)) {
      errors.push(`unexpected receipt: ${sourceUrl}`);
    }
  }

  if (anomalyReport) {
    if (anomalyReport.schemaVersion !== ANOMALY_SCHEMA_VERSION) {
      errors.push('anomaly report schemaVersion mismatch');
    }
    if (
      anomalyReport.sourceInventorySha256 !== inventory.inventorySha256
    ) {
      errors.push('anomaly report source inventory digest is stale');
    }
    if (
      anomalyReport.readerSemanticDigest !==
      inventory.readerSemanticDigest
    ) {
      errors.push('anomaly report reader semantic digest is stale');
    }
    if (anomalyReport.targetCount !== inventory.targetCount) {
      errors.push('anomaly report target count is stale');
    }
    if (!Array.isArray(anomalyReport.anomalies)) {
      errors.push('anomaly report anomalies must be an array');
    } else if (anomalyReport.anomalies.length > 0) {
      errors.push(
        `media collection has ${anomalyReport.anomalies.length} unresolved anomalies`,
      );
    }
  }

  return errors;
}

export function receiptContentMatches(left, right) {
  return [
    'sourceUrl',
    'finalUrl',
    'bytes',
    'sha256',
    'mime',
    'width',
    'height',
    'rightsBasis',
  ].every((field) => left?.[field] === right?.[field]) &&
    sameUses(left?.uses, right?.uses) &&
    canonicalJson(left?.redirects || []) ===
      canonicalJson(right?.redirects || []);
}
