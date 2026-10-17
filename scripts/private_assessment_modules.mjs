// Lossless build-time line interning. Keep the exact projected response strings,
// including whitespace used by curriculum/prompt digests, inside Worker modules.
const CHUNK_BYTES = 2 * 1024 * 1024;
export const WORKER_SIZE_LIMIT = 25 * 1024 * 1024;

export function privateAssessmentModules(data) {
  const lines = [];
  const ids = new Map();
  const chunks = [];
  let chunk = [], size = 0;
  for (const [key, text] of Object.entries(data)) {
    const references = text.split('\n').map(line => {
      if (!ids.has(line)) {
        ids.set(line, lines.length);
        lines.push(line);
      }
      return ids.get(line);
    });
    const record = [key, references];
    const bytes = Buffer.byteLength(JSON.stringify(record));
    if (size && size + bytes > CHUNK_BYTES) {
      chunks.push(chunk);
      chunk = [];
      size = 0;
    }
    chunk.push(record);
    size += bytes;
  }
  if (size) chunks.push(chunk);
  const modules = [];
  if (chunks.length) {
    modules.push({path: '_assessment-data/lines.js', bytes: Buffer.from(`export default ${JSON.stringify(lines)};\n`)});
  }
  chunks.forEach((records, i) => {
    const source = "import lines from './lines.js';\n"
      + `export default Object.fromEntries(${JSON.stringify(records)}.map(([key, ids]) => [key, ids.map(id => lines[id]).join('\\n')]));\n`;
    modules.push({path: `_assessment-data/${i}.js`, bytes: Buffer.from(source)});
  });
  const entry = chunks.map((_, i) => `import data${i} from './_assessment-data/${i}.js';`).join('\n')
    + '\nexport default {' + chunks.map((_, i) => `...data${i}`).join(',') + '};\n';
  return {modules, entry: Buffer.from(entry)};
}

export function assertWorkerSize(files) {
  const bytes = files.filter(file => file.path === '_worker.js' || file.path.startsWith('_worker.js/'))
    .reduce((sum, file) => sum + file.bytes.length, 0);
  if (bytes >= WORKER_SIZE_LIMIT) {
    throw Error(`Worker modules total ${bytes} bytes; must stay below ${WORKER_SIZE_LIMIT} bytes (25 MiB)`);
  }
  return bytes;
}
