# Frozen curricula for historical calibration regressions

`lesson-1498.json` and `lesson-1711-p1.json` are the dialogue curricula as accepted at `3c9fff7` (r40), the exact
sources the consumed calibration packets (`site/dialogue-calibration-packet.json`, amendment4, amendment5, the
full-language scope) were pinned to. The 2026-11-04 vocabulary corrections (`bank-fix-yw-20261104`) changed the
released curricula of these two lessons; the historical packets stay byte-frozen and the retired calibration
engines fail closed on the new curricula, so their offline regressions read these frozen copies.
The live language-calibration projection (`site/dialogue-calibration-status.json`) was re-bound to the new
curricula with item-by-item proof (`scripts/repin_calibration_status_20261104.mjs`).

`lesson-1690.json` and `lesson-1717-p2.json` (added 2026-11-04, r43) are the curricula as accepted at `242a5da` (r42).
Removing the leaked forum bold marker `**` from the reader documents re-bound every reader document (media receipt
ledger), so every curriculum's `sourceInventory.readerSha256` moved; the amendment4/amendment5 packets pinned these two
lessons at their r42 curricula. lesson-1498 and lesson-1711-p1 keep their r40 copies. The live projection was re-bound
again with path-by-path proof (bank-fix-yw-20261104/yw-release-r43/calibration-repin-r43.json).
