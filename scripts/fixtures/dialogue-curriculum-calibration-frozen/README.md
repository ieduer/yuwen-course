# Frozen curricula for historical calibration regressions

`lesson-1498.json` and `lesson-1711-p1.json` are the dialogue curricula as accepted at `3c9fff7` (r40), the exact
sources the consumed calibration packets (`site/dialogue-calibration-packet.json`, amendment4, amendment5, the
full-language scope) were pinned to. The 2026-11-04 vocabulary corrections (`bank-fix-yw-20261104`) changed the
released curricula of these two lessons; the historical packets stay byte-frozen and the retired calibration
engines fail closed on the new curricula, so their offline regressions read these frozen copies.
The live language-calibration projection (`site/dialogue-calibration-status.json`) was re-bound to the new
curricula with item-by-item proof (`scripts/repin_calibration_status_20261104.mjs`).
