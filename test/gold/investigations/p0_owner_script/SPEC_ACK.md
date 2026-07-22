# P0 RECORDED REPRO — SPEC_ACK (2026-07-20)

MISSION: record the reported exact 6-beat **yajin** script on the gold **lagged** rig — video ON +
a per-action **tx-outcome JSON column** (landed-matching | never-landed | landed-divergent |
lock-contention | reserve-refused) beside the video. Beats IN ORDER: ① cast a TRAP · ② WALK several
cells · ③ TRY TO ESCAPE the fight · ④ GET TACKLED by an adjacent mob · ⑤ PUSH a mob INTO the trap ·
⑥ VERIFY sim kills STICK (pushed-dead stays dead — no reappear across ≥3 subsequent chain folds).
Per-beat asserts: trap persists ≥2 folds · position never regresses post-commit · commit outcomes
recorded · pushed-dead stays dead.

RIG: gold stack UP + healthy (7/7 `aresrpg-gold-*` containers, up ~3h) — verified 2026-07-20.

FIRST ACTION: evaluate the lane-1 residue (`specs_anchor/p0_owner_script.spec.ts`, 37KB) + lane-2's
multi_turn-fixture hint against my `investigations/b5/` driver + `fight_record_verify` /
`fight_mouse_helpers` idioms, then assemble the recorded spec under
`investigations/p0_owner_script/` and run it FOREGROUND on `--project=lagged`.

STATUS: ACK filed. Proceeding to residue evaluation. Budget 2 attempts; foreground; no commits/spawns.
