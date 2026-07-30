#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  REPO_ROOT,
  extractReaderMediaTargets,
  validateReceiptLedger,
} from './reader_media_receipts_lib.mjs';

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
  };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--ledger') {
      options.ledgerPath = resolve(argv[index + 1]);
      index += 1;
    } else if (argv[index] === '--anomalies') {
      options.anomalyPath = resolve(argv[index + 1]);
      index += 1;
    } else {
      throw new Error(`unknown argument: ${argv[index]}`);
    }
  }
  return options;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const ledger = JSON.parse(readFileSync(options.ledgerPath, 'utf8'));
  const anomalyReport = JSON.parse(
    readFileSync(options.anomalyPath, 'utf8'),
  );
  const inventory = extractReaderMediaTargets();
  const errors = [
    ...inventory.issues.map(
      (issue) => `${issue.code}: ${issue.message}`,
    ),
    ...validateReceiptLedger({ ledger, inventory, anomalyReport }),
  ];
  if (errors.length > 0) {
    throw new Error(errors.join('\n'));
  }
  process.stdout.write(
    `reader media receipts valid: ${ledger.receiptCount} objects, inventory ${ledger.sourceInventorySha256}\n`,
  );
}

try {
  main();
} catch (error) {
  process.stderr.write(`validate_reader_media_receipts: ${error.message}\n`);
  process.exitCode = 1;
}
