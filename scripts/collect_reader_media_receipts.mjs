#!/usr/bin/env node

import {
  existsSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { resolve } from 'node:path';
import {
  ANOMALY_SCHEMA_VERSION,
  DEFAULT_ALLOWED_HOSTS,
  DEFAULT_LEDGER_VERSION,
  DEFAULT_MAX_OBJECT_BYTES,
  DEFAULT_MAX_TOTAL_BYTES,
  DEFAULT_TIMEOUT_MS,
  RECEIPT_SCHEMA_VERSION,
  REPO_ROOT,
  RIGHTS_BASIS,
  extractReaderMediaTargets,
  fetchImageReceipt,
  prettyJson,
  receiptContentMatches,
  validateReceiptLedger,
} from './reader_media_receipts_lib.mjs';

function parsePositiveInteger(value, label) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
  return number;
}

function parseArgs(argv) {
  const options = {
    ledgerPath: resolve(
      REPO_ROOT,
      'site/data/reader-media-receipts.v1.json',
    ),
    anomalyPath: resolve(
      REPO_ROOT,
      'site/data/reader-media-receipt-anomalies.v1.json',
    ),
    ledgerVersion: DEFAULT_LEDGER_VERSION,
    maxObjectBytes: DEFAULT_MAX_OBJECT_BYTES,
    maxTotalBytes: DEFAULT_MAX_TOTAL_BYTES,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    allowedHosts: new Set(DEFAULT_ALLOWED_HOSTS),
    collectedAt: null,
    readerDocumentsDir: resolve(
      REPO_ROOT,
      'site/data/reader-documents',
    ),
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const next = argv[index + 1];
    if (argument === '--ledger') {
      options.ledgerPath = resolve(next);
      index += 1;
    } else if (argument === '--anomalies') {
      options.anomalyPath = resolve(next);
      index += 1;
    } else if (argument === '--ledger-version') {
      options.ledgerVersion = String(next || '').trim();
      index += 1;
    } else if (argument === '--max-object-bytes') {
      options.maxObjectBytes = parsePositiveInteger(
        next,
        '--max-object-bytes',
      );
      index += 1;
    } else if (argument === '--max-total-bytes') {
      options.maxTotalBytes = parsePositiveInteger(
        next,
        '--max-total-bytes',
      );
      index += 1;
    } else if (argument === '--timeout-ms') {
      options.timeoutMs = parsePositiveInteger(next, '--timeout-ms');
      index += 1;
    } else if (argument === '--allow-host') {
      options.allowedHosts.add(String(next || '').trim().toLowerCase());
      index += 1;
    } else if (argument === '--collected-at') {
      options.collectedAt = String(next || '').trim();
      index += 1;
    } else if (argument === '--reader-documents-dir') {
      options.readerDocumentsDir = resolve(next);
      index += 1;
    } else {
      throw new Error(`unknown argument: ${argument}`);
    }
  }

  if (!options.ledgerVersion) throw new Error('--ledger-version is required');
  if (
    options.collectedAt &&
    !Number.isFinite(Date.parse(options.collectedAt))
  ) {
    throw new Error('--collected-at must be an ISO date-time');
  }
  if (options.maxTotalBytes < options.maxObjectBytes) {
    throw new Error('--max-total-bytes must be at least --max-object-bytes');
  }
  return options;
}

function readJsonIfPresent(path) {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf8'));
}

function atomicWriteJson(path, value) {
  const temporaryPath = `${path}.tmp-${process.pid}`;
  writeFileSync(temporaryPath, prettyJson(value), 'utf8');
  renameSync(temporaryPath, path);
}

function anomalyFromError(target, error) {
  return {
    code: error?.code || 'collection-failed',
    sourceUrl: target.sourceUrl,
    uses: target.uses,
    message: error?.message || String(error),
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const inventory = extractReaderMediaTargets({
    allowedHosts: options.allowedHosts,
    readerDocumentsDir: options.readerDocumentsDir,
  });
  const anomalyReport = {
    schemaVersion: ANOMALY_SCHEMA_VERSION,
    readerSemanticDigest: inventory.readerSemanticDigest,
    sourceInventorySha256: inventory.inventorySha256,
    targetCount: inventory.targetCount,
    anomalies: [...inventory.issues],
  };

  if (inventory.issues.length > 0) {
    atomicWriteJson(options.anomalyPath, anomalyReport);
    throw new Error(
      `target inventory has ${inventory.issues.length} fail-closed issues`,
    );
  }

  const previousLedger = readJsonIfPresent(options.ledgerPath);
  const previousReceipts = new Map(
    (previousLedger?.receipts || []).map((receipt) => [
      receipt.sourceUrl,
      receipt,
    ]),
  );
  const attemptedAt =
    options.collectedAt || new Date().toISOString();
  const receipts = [];
  let totalBytes = 0;

  for (let index = 0; index < inventory.targets.length; index += 1) {
    const target = inventory.targets[index];
    const remainingBytes = options.maxTotalBytes - totalBytes;
    if (remainingBytes <= 0) {
      anomalyReport.anomalies.push({
        code: 'total-byte-budget-exhausted',
        sourceUrl: target.sourceUrl,
        uses: target.uses,
        message: `collection reached the ${options.maxTotalBytes} byte total limit`,
      });
      break;
    }
    process.stderr.write(
      `[${index + 1}/${inventory.targetCount}] ${target.sourceUrl}\n`,
    );
    try {
      const fetched = await fetchImageReceipt({
        sourceUrl: target.sourceUrl,
        allowedHosts: options.allowedHosts,
        maxObjectBytes: Math.min(
          options.maxObjectBytes,
          remainingBytes,
        ),
        timeoutMs: options.timeoutMs,
      });
      totalBytes += fetched.bytes;
      const candidate = {
        ...fetched,
        uses: target.uses,
        collectedAt: attemptedAt,
        rightsBasis: RIGHTS_BASIS,
      };
      const previous = previousReceipts.get(target.sourceUrl);
      if (previous && receiptContentMatches(previous, candidate)) {
        candidate.collectedAt = previous.collectedAt;
      }
      receipts.push(candidate);
    } catch (error) {
      anomalyReport.anomalies.push(anomalyFromError(target, error));
    }
  }

  anomalyReport.anomalies.sort((left, right) =>
    String(left.sourceUrl || '').localeCompare(
      String(right.sourceUrl || ''),
    ),
  );
  atomicWriteJson(options.anomalyPath, anomalyReport);

  if (anomalyReport.anomalies.length > 0) {
    throw new Error(
      `${anomalyReport.anomalies.length} media anomalies; receipt ledger was not updated`,
    );
  }

  const ledger = {
    schemaVersion: RECEIPT_SCHEMA_VERSION,
    ledgerVersion: options.ledgerVersion,
    readerSemanticDigest: inventory.readerSemanticDigest,
    sourceInventorySha256: inventory.inventorySha256,
    rightsBasis: RIGHTS_BASIS,
    receiptCount: receipts.length,
    totalBytes,
    receipts,
  };
  const errors = validateReceiptLedger({
    ledger,
    inventory,
    anomalyReport,
    allowedHosts: options.allowedHosts,
    maxObjectBytes: options.maxObjectBytes,
  });
  if (errors.length > 0) {
    throw new Error(`generated ledger is invalid:\n- ${errors.join('\n- ')}`);
  }

  atomicWriteJson(options.ledgerPath, ledger);
  process.stdout.write(
    `reader media receipts: ${ledger.receiptCount} objects, ${ledger.totalBytes} bytes, inventory ${ledger.sourceInventorySha256}\n`,
  );
}

main().catch((error) => {
  process.stderr.write(`collect_reader_media_receipts: ${error.message}\n`);
  process.exitCode = 1;
});
