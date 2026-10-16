import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { nativeArtifactInventory } from "./build_release_site.mjs";

test("native inventory matches publisher depth-first byte ordering", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "yw-inventory-"));
  try {
    const expected = ["-data.json", ".bdfz-release-artifact.json", "A.json", "_worker.js", "a/z.json", "a-b.json", "a.json"];
    for (const name of [...expected].reverse()) {
      fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
      fs.writeFileSync(path.join(root, name), name);
    }
    assert.deepEqual(nativeArtifactInventory(root).map(f => f.path), expected);
    fs.symlinkSync(path.join(root, "A.json"), path.join(root, "linked.json"));
    assert.throws(() => nativeArtifactInventory(root), /symlink/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
