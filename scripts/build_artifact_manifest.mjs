import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const SITE = path.join(ROOT, "site");
const OUTPUT = path.join(ROOT, "docs/baselines/site-artifact-manifest.json");
const CHECK_ONLY = process.argv.includes("--check");

async function collect(directory, prefix = "") {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...await collect(path.join(directory, entry.name), relative));
    else if (entry.isFile()) files.push(relative);
  }
  return files.sort((a, b) => a.localeCompare(b, "en"));
}

const files = [];
for (const relative of await collect(SITE)) {
  const bytes = await readFile(path.join(SITE, relative));
  files.push({ path: relative, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") });
}
const aggregateSha256 = createHash("sha256")
  .update(files.map((file) => `${file.sha256}  ${file.path}\n`).join(""))
  .digest("hex");
const manifest = {
  schemaVersion: 1,
  artifactRoot: "site/",
  fileCount: files.length,
  totalBytes: files.reduce((sum, file) => sum + file.bytes, 0),
  aggregateSha256,
  files,
};
const serialized = `${JSON.stringify(manifest, null, 2)}\n`;

if (CHECK_ONLY) {
  const current = await readFile(OUTPUT, "utf8").catch(() => "");
  if (current !== serialized) {
    console.error("site artifact manifest is stale; run npm run build:artifact-manifest");
    process.exit(1);
  }
  console.log(`site artifact manifest is current: ${files.length} files, ${aggregateSha256}`);
  process.exit(0);
}

await mkdir(path.dirname(OUTPUT), { recursive: true });
await writeFile(OUTPUT, serialized);
console.log(`site artifact manifest: ${files.length} files, ${aggregateSha256}`);
