import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {privateAssessmentModules,assertWorkerSize,WORKER_SIZE_LIMIT} from './private_assessment_modules.mjs';

async function withLoaded(data, check) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yw-private-lines-'));
  try {
    const packed = privateAssessmentModules(data);
    fs.writeFileSync(path.join(root, 'package.json'), '{"type":"module"}');
    for (const file of [...packed.modules, {path: 'assessment-private-data.js', bytes: packed.entry}]) {
      fs.mkdirSync(path.dirname(path.join(root, file.path)), {recursive: true});
      fs.writeFileSync(path.join(root, file.path), file.bytes);
    }
    const restored = (await import(pathToFileURL(path.join(root, 'assessment-private-data.js')))).default;
    await check(restored, packed);
  } finally {
    fs.rmSync(root, {recursive: true, force: true});
  }
}

test('private module roundtrip preserves exact response bytes and distinct paths', async () => {
  const data = {
    '/empty.json': '',
    '/single.json': '{"sourceAnswer":"漢字 😀 \\n \\t"}',
    '/crlf.json': '{\r\n\t"answerIndex": 0,\r\n\t"value": "\\\\\\\""\r\n}\r\n',
    '/blank-lines.json': '\n\n repeated \n repeated \n',
    '/__proto__': 'zero\0\u2028\u2029\n',
  };
  await withLoaded(data, restored => assert.deepEqual(restored, data));
  assert.deepEqual(privateAssessmentModules(data), privateAssessmentModules(data), 'deterministic module bytes');
});

test('empty private corpus needs no data modules', async () => {
  await withLoaded({}, (restored, packed) => {
    assert.deepEqual(restored, {});
    assert.deepEqual(packed.modules, []);
  });
});

test('repeated private text shrinks without dropping any answer or whitespace', async () => {
  const text = JSON.stringify({referenceAnswer: '完整答案'.repeat(80), sourceAnswer: 0}, null, 2) + '\n';
  const data = Object.fromEntries(Array.from({length: 200}, (_, i) => [`/case-${i}.json`, text]));
  await withLoaded(data, (restored, packed) => {
    assert.deepEqual(restored, data);
    const bytes = packed.entry.length + packed.modules.reduce((n, f) => n + f.bytes.length, 0);
    assert.ok(bytes < Buffer.byteLength(JSON.stringify(data)) / 4);
  });
});

test('Worker aggregate gate counts all private modules but excludes public assets', () => {
  const bytes = Buffer.alloc(WORKER_SIZE_LIMIT);
  assert.equal(assertWorkerSize([{path: '_worker.js/index.js', bytes: bytes.subarray(1)}, {path: 'assets/large.txt', bytes}]), WORKER_SIZE_LIMIT - 1);
  assert.throws(() => assertWorkerSize([{path: '_worker.js/index.js', bytes: bytes.subarray(1)}, {path: '_worker.js/_assessment-data/0.js', bytes: Buffer.from('x')}]), /must stay below/);
  assert.throws(() => assertWorkerSize([{path: '_worker.js', bytes}]), /must stay below/);
});
