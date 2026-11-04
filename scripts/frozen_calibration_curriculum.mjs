// Offline regressions of the consumed calibration packets read the curricula those packets were pinned to.
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const frozenDir = path.join(root, 'scripts/fixtures/dialogue-curriculum-calibration-frozen');
export const frozenCurriculumPath = (id) => {
  const frozen = path.join(frozenDir, id + '.json');
  return fs.existsSync(frozen) ? frozen : path.join(root, 'site/dialogue-curriculum', id + '.json');
};
export const loadFrozenCurriculum = (id) => JSON.parse(fs.readFileSync(frozenCurriculumPath(id)));
