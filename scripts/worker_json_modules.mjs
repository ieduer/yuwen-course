import path from 'node:path';
import {createHash} from 'node:crypto';
import {transformSync} from 'esbuild';

// Pages module uploads require ordinary ESM here. Convert only Worker-private
// JSON modules; public/native JSON and the source packets keep their original bytes.
export function workerJsonModules(files) {
  const names = new Set(files.filter(f => f.path.startsWith('_worker.js/') && f.path.endsWith('.json')).map(f => f.path));
  const occupied = new Set(files.map(f => f.path));
  for (const name of names) {
    if (occupied.has(name + '.js')) throw Error('Worker JSON output collision: ' + name);
  }
  return files.map(file => {
    if (!file.path.startsWith('_worker.js/')) return file;
    let name = file.path, bytes = file.bytes;
    if (names.has(name)) {
      JSON.parse(bytes.toString());
      bytes = Buffer.from(transformSync(bytes.toString(), {loader: 'json', format: 'esm', minifyWhitespace: true, legalComments: 'none'}).code);
      name += '.js';
    } else {
      const text = bytes.toString();
      const rewritten = text.replace(/from (['"])(\.\.?\/[^'"]+\.json)\1\s+with\s*\{\s*type:\s*['"]json['"]\s*\}/g, (whole, quote, relative) => {
        const target = path.posix.normalize(path.posix.join(path.posix.dirname(name), relative));
        if (!names.has(target)) throw Error('Worker JSON import target missing: ' + target);
        return 'from ' + quote + relative + '.js' + quote;
      });
      if (/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)['"][^'"]+\.json['"]/.test(rewritten)) {
        throw Error('Unsupported Worker JSON import syntax: ' + name);
      }
      if (rewritten === text) return file;
      bytes = Buffer.from(rewritten);
    }
    return {...file, path: name, bytes, sha256: createHash('sha256').update(bytes).digest('hex')};
  });
}
