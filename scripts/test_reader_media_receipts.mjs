import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import {
  ANOMALY_SCHEMA_VERSION,
  RECEIPT_SCHEMA_VERSION,
  REQUIRED_MEDIA_TARGETS,
  RIGHTS_BASIS,
  ReceiptCollectionError,
  extractReaderMediaTargets,
  fetchImageReceipt,
  inspectImage,
  sha256Hex,
  validateReceiptLedger,
} from './reader_media_receipts_lib.mjs';

function png(width, height) {
  const buffer = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(
    buffer,
  );
  buffer.write('IHDR', 12, 'ascii');
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  return buffer;
}

function jpeg(width, height) {
  return Buffer.from([
    0xff, 0xd8,
    0xff, 0xc0, 0x00, 0x11, 0x08,
    (height >> 8) & 0xff, height & 0xff,
    (width >> 8) & 0xff, width & 0xff,
    0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x00, 0x03, 0x11, 0x00,
    0xff, 0xd9,
  ]);
}

function webp(width, height) {
  const buffer = Buffer.alloc(30);
  buffer.write('RIFF', 0, 'ascii');
  buffer.writeUInt32LE(22, 4);
  buffer.write('WEBP', 8, 'ascii');
  buffer.write('VP8X', 12, 'ascii');
  buffer.writeUInt32LE(10, 16);
  const writeUint24 = (value, offset) => {
    buffer[offset] = value & 0xff;
    buffer[offset + 1] = (value >> 8) & 0xff;
    buffer[offset + 2] = (value >> 16) & 0xff;
  };
  writeUint24(width - 1, 24);
  writeUint24(height - 1, 27);
  return buffer;
}

function response(body, init = {}) {
  return new Response(body, init);
}

test('image inspection reads PNG, JPEG, and WebP byte dimensions', () => {
  assert.deepEqual(inspectImage(png(320, 240)), {
    mime: 'image/png',
    width: 320,
    height: 240,
  });
  assert.deepEqual(inspectImage(jpeg(227, 340)), {
    mime: 'image/jpeg',
    width: 227,
    height: 340,
  });
  assert.deepEqual(inspectImage(webp(1532, 930)), {
    mime: 'image/webp',
    width: 1532,
    height: 930,
  });
});

test('target extraction keeps only primary and supplementary source images', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'yw-media-targets-'));
  const readerDir = resolve(root, 'site/data/reader-documents');
  const lessonsDir = resolve(root, 'site/data/lessons');
  mkdirSync(readerDir, { recursive: true });
  mkdirSync(lessonsDir, { recursive: true });
  writeFileSync(
    resolve(readerDir, 'index.json'),
    JSON.stringify({
      readerSemanticDigest: `sha256:${'c'.repeat(64)}`,
    }),
  );
  const allowed = 'https://files.rdfzer.com/original/primary.png';
  const supplement =
    'https://files.rdfzer.com/original/supplement.jpeg';
  const excluded = 'https://files.rdfzer.com/original/discussion.webp';
  writeFileSync(
    resolve(readerDir, 'lesson-test.json'),
    JSON.stringify({
      lessonId: 'lesson-test',
      main: { media: [] },
      supplementary: [],
      provenance: {
        posts: [
          { postNumber: 1, role: 'primary' },
          { postNumber: 2, role: 'supplementary' },
          { postNumber: 3, role: 'discussion' },
        ],
        media: [],
      },
    }),
  );
  writeFileSync(
    resolve(lessonsDir, 'lesson-test.json'),
    JSON.stringify({
      forumImages: [
        { src: allowed, postNumber: 1 },
        { src: supplement, postNumber: 2 },
        { src: excluded, postNumber: 3 },
      ],
      posts: [],
    }),
  );

  try {
    const inventory = extractReaderMediaTargets({
      repoRoot: root,
      readerDocumentsDir: readerDir,
      lessonsDir,
    });
    const urls = inventory.targets.map((target) => target.sourceUrl);
    assert.equal(inventory.issues.length, 0);
    assert.ok(urls.includes(allowed));
    assert.ok(urls.includes(supplement));
    assert.ok(!urls.includes(excluded));
    assert.ok(urls.includes(REQUIRED_MEDIA_TARGETS[0].sourceUrl));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('fetch follows only allowlisted HTTPS redirects and records final bytes', async () => {
  const bytes = png(12, 34);
  const calls = [];
  const receipt = await fetchImageReceipt({
    sourceUrl: 'https://forum.rdfzer.com/uploads/image.png',
    fetchImpl: async (url) => {
      calls.push(url);
      if (calls.length === 1) {
        return response(null, {
          status: 302,
          headers: {
            location:
              'https://files.rdfzer.com/original/image.png',
          },
        });
      }
      return response(bytes, {
        status: 200,
        headers: {
          'content-type': 'image/png',
          'content-length': String(bytes.length),
        },
      });
    },
  });

  assert.equal(receipt.finalUrl, calls[1]);
  assert.deepEqual(receipt.redirects, [calls[1]]);
  assert.equal(receipt.bytes, bytes.length);
  assert.equal(receipt.sha256, sha256Hex(bytes));
  assert.equal(receipt.width, 12);
  assert.equal(receipt.height, 34);
});

test('fetch fails closed on unsafe redirect and oversized object', async () => {
  await assert.rejects(
    fetchImageReceipt({
      sourceUrl: 'https://forum.rdfzer.com/uploads/image.png',
      fetchImpl: async () =>
        response(null, {
          status: 302,
          headers: { location: 'http://127.0.0.1/private.png' },
        }),
    }),
    (error) =>
      error instanceof ReceiptCollectionError &&
      error.code === 'unsafe-redirect',
  );

  await assert.rejects(
    fetchImageReceipt({
      sourceUrl: 'https://files.rdfzer.com/original/image.png',
      maxObjectBytes: 10,
      fetchImpl: async () =>
        response(png(1, 1), {
          status: 200,
          headers: {
            'content-type': 'image/png',
            'content-length': '999',
          },
        }),
    }),
    (error) =>
      error instanceof ReceiptCollectionError &&
      error.code === 'oversized-content-length',
  );
});

test('ledger validator enforces exact coverage, rights, and zero anomalies', () => {
  const target = {
    sourceUrl: REQUIRED_MEDIA_TARGETS[0].sourceUrl,
    uses: [
      {
        lessonId: 'lesson-1557',
        role: 'primary',
        postNumber: 1,
      },
    ],
  };
  const inventory = {
    readerSemanticDigest: `sha256:${'c'.repeat(64)}`,
    inventorySha256: 'a'.repeat(64),
    targetCount: 1,
    targets: [target],
  };
  const ledger = {
    schemaVersion: RECEIPT_SCHEMA_VERSION,
    ledgerVersion: 'test-v1',
    readerSemanticDigest: inventory.readerSemanticDigest,
    sourceInventorySha256: inventory.inventorySha256,
    rightsBasis: RIGHTS_BASIS,
    receiptCount: 1,
    totalBytes: 24,
    receipts: [
      {
        sourceUrl: target.sourceUrl,
        finalUrl: target.sourceUrl,
        bytes: 24,
        sha256: 'b'.repeat(64),
        mime: 'image/png',
        width: 1,
        height: 1,
        redirects: [],
        collectedAt: '2026-07-30T00:00:00.000Z',
        rightsBasis: RIGHTS_BASIS,
        uses: target.uses,
      },
    ],
  };
  const anomalyReport = {
    schemaVersion: ANOMALY_SCHEMA_VERSION,
    readerSemanticDigest: inventory.readerSemanticDigest,
    sourceInventorySha256: inventory.inventorySha256,
    targetCount: 1,
    anomalies: [],
  };

  assert.deepEqual(
    validateReceiptLedger({ ledger, inventory, anomalyReport }),
    [],
  );
  anomalyReport.anomalies.push({
    code: 'http-status',
    sourceUrl: target.sourceUrl,
  });
  assert.match(
    validateReceiptLedger({ ledger, inventory, anomalyReport }).join('\n'),
    /unresolved anomalies/,
  );
});
