# PR #966 — driven proof (placement-resume re-derive)

Build: `lane/placement-resume-2` · dev server from that worktree on `:5310`
(`VITE_RPC_URL=https://rpc.aresrpg.world`) · LIVE testnet · identity `alice`
(`0xb4951afe3682d3e9425671f1772e3676bc6ff361ac00896ea131cf52765cd177`, character
`0xe3d99d594f2acab553445e83ad122482ae242fa42df0771a4f5c4e98b33fce7b`) · one browser throughout.

Status namespaces under test (`fight_chain_status.js`): CHAIN placement=0/active=1 vs VIEW
(`board_state`) placement=5/active=1. Evidence below quotes both, which is what makes the fix legible.

### Which revision each leg actually ran on

The lane sits on an automated rebase loop and moved **five times** during this pass (reflog: 10:25, 10:32 →
`695dab7d`, 10:51, 10:59, 11:20, 11:26 → `8f207c04`). The dev server was started at 10:51:33, 16 s before the
third rebase, and every leg is a full page reload, so each leg loaded whatever was on disk at that moment.

| Leg | Wall clock | Lane head in effect |
|---|---|---|
| Bar 3 trial 1 | 10:56–11:01 | `d16f5cac` (then `6c5d6f76` from 10:59:24) |
| Bars 1 · 2 · 4 · 5 | 11:35–11:38 | `8f207c04` (current head) |
| Bar 3 trial 2 | 11:54–11:59 | `8f207c04` (current head) |

**This does not weaken the verdicts.** The PR's own files are byte-identical across the whole window —
`git diff 695dab7d..8f207c04 -- fight-liquidation.js world_fight.js fight_chain_status.js` is **empty**; the
two #932 commits were only re-picked onto a newer `origin/edge`. Every bar therefore exercised the same PR
code, and bar 3 additionally reproduces on two different lane revisions.

What DID change underneath was edge, including `647549ff fix(fight): an expired turn advances itself, it is
never narrated (#921)`, which rewrote `fight_expiry_gate.js` and `fight_state_trace.js` mid-pass. That is the
origin of the `[fight] expired turn could not be advanced` line quoted later — it is #921's new
`should_report_stall` telemetry, **not** anything this PR introduced. It first appears in my logs 12 s after
the 10:59:24 rebase that brought #921 in.

| # | Bar | Verdict |
|---|-----|---------|
| 1 | Engage → chain placement w/ alice's seat → hard refresh → re-enters the placement board, no manual action, no refusal line | **PASS** |
| 2 | Second refresh mid-placement → re-enters again | **PASS** |
| 3 | Expired placement heals on cold boot (force_start → board mounts, fight active) | **FAIL** |
| 4 | REGRESSION BAR — never announce the fight cleared / release the character while the seat is live on chain | **PASS** |
| 5 | Zero unattributed console/page errors | **PASS** (bars 1/2) · attributed failure on bar 3 |
| 6 | Teardown — every fight settled via the product forfeit flow, spend under ceiling | **PASS** |

## Bars 1 · 2 · 4 · 5 — PASS

Fight `0x00bd6dd6237cca06b3cb7c8f318122626adef8157a7521b9be356051fdb0c483`
(`logs/pr966_bar124_r3.log`, `logs/pr966_bar124.json`).

Engaged via the real `[R]` ATTACK prompt after roaming to the pack. Chain immediately after engage:

```
CHAIN PRE-REFRESH: {"status":0,"placement_deadline_ms":1785040720219,"turn_deadline_ms":0,
  "seats":1,"seat_owners":["0xb495...d177"],"seat_characters":["0xe3d9...ce7b"]}
window_left_ms = 62682   deadline 2026-07-26T04:38:40.219Z   alice seat present: true
```

Two consecutive hard refreshes, each re-entering with **no manual action**:

```
BAR1 board_up=true in 10675ms · chain status=0 · window_open=true · seat_live=true
BAR1 REFUSAL lines: []   BAR1 RELEASE lines (bar4): []   BAR1 RELEASE toasts (bar4): []
BAR2 board_up=true in 10506ms · chain status=0 · window_open=true · seat_live=true
BAR2 REFUSAL lines: []   BAR2 RELEASE lines (bar4): []   BAR2 RELEASE toasts (bar4): []
ALL page errors: (none)   ALL console.error: (none)
```

`DEV_STATE` after both reloads reports VIEW `status:5` (placement) against CHAIN `status:0` — the two
namespaces resolving to the same fight, which is exactly the bug class #932 fixed.

Screenshots (`shots/BAR124_11_after_refresh_1.png`, `shots/BAR124_12_after_refresh_2.png`) show the
placement board back up: "POSITION YOUR TEAM" with the live countdown (0:53 then 0:42, tracking the real
chain deadline), glowing start cells, the seat + both mobs, READY and FORFEIT.

## Bar 4 (regression) — PASS

Across every leg of this pass — two mid-placement refreshes, two expired-placement cold boots — the client
**never** emitted a release signal while the seat was live on chain. Watchlist (all zero hits):
`already resolved` / `your character is free` (the `fights.expired_fight_cleared` toast),
`resume rejected — persisted Fight is`, `fight_resume_expired_gone`, `Dungeon fight is settled|absent`,
`_recover_dead_fight_reference`. The fight reference persisted across both refreshes.

On the bar-3 failure path the client refuses and **holds** the reference rather than freeing the character —
strictly better than the pre-fix behaviour, where CHAIN placement `0` fell through the VIEW `5` comparison to
`skip` → `gone` → toast + release.

## Bar 3 — FAIL: a `force_start` that LANDS is reported as "did not land", and the board never mounts

Reproduced on two independent fights. In both, the cold boot fired `force_start`, the transaction
**succeeded on chain**, the fight went ACTIVE — and the client had already concluded the door failed, refused,
and never mounted a board. The player is left roaming with a live seat.

| Trial | Fight | Refusal logged | `turns::force_start` on chain | Digest |
|---|---|---|---|---|
| 1 | `0x3d9aaaaf…c85a` | `03:57:01.360Z` | **success** `03:57:01.060Z` (300 ms *before*) | `KH37SNmtTiFMn9yE6kCeDHTfBT5g6iCLyvPdgfCAupj` |
| 2 | `0x00bd6dd6…c483` | `04:54:47.787Z` | **success** `04:54:51.674Z` (3.9 s *after*) | `6LH9GGwtEUxTkxF74zf8z9uUgZxFjGPBhEoQ9qkCezec` |

```
[world-fight] resume refused — fight 0x00bd6dd6…c483 not re-entered:
  chain status placement (0) — its force_start door did not land
BAR3 board_up=false after 151399ms
BAR3 CHAIN: {"status":1,...}      ← chain is ACTIVE; the door DID land
BAR3 /v1 status: active
```

Mechanically: `ensure_resumable_fight` (`fight-liquidation.js`) does `await door(fight_id, true)` then
re-reads **immediately**. `door()` resolves before the transaction's effects are readable — trial 2 shows the
refusal beating the on-chain success by 3.9 s, trial 1 shows read lag of 300 ms — so `verdict(read)` still
sees `placement` + expired, returns `force_start` again, and the function falls through to
`{ decision: 'skip', reason: '… — its force_start door did not land' }`. There is no wait-for-effects and no
re-check, and the pass never retries, so the boot that performed the heal is the one that cannot see it.

Note the door is **not** idempotent-safe to re-fire blindly: `turns::force_start` asserts
`status == placement`, so once it lands a second call aborts. The fix is to observe the effects of the tx
that was already sent, not to send another (tx-retry burn law).

Adjacent observation, **not this PR's**: `[fight] expired turn could not be advanced` fired on both settle
boots — that line is #921's `should_report_stall` telemetry (`647549ff`), which landed in edge mid-pass. In
trial 1 it fired at `03:59:36.674Z` while `turns::crank` had succeeded `0.8 s` earlier
(`C4QknaVGHmPt9CV6EUwJg7cvrBwmSHhMsSFF4zXyHug`, `03:59:35.872Z`), i.e. the same read-lag family as the bar-3
failure but reached through #921's code. Worth a look on that ticket, not this one.

`shots/BAR3_20_after_expiry_boot.png` is the user-visible outcome: the character roaming in VERDANT HOLLOW
with the "Win a Fight" quest card up, no board, while the chain has it seated in an ACTIVE fight. No
forfeit control is reachable in that state (`NO FORFEIT BUTTON` in `logs/pr966_bar3_r2.log`) — the only exit
found was a second boot once the fight was ACTIVE, which resumes correctly and exposes FORFEIT again.

An expired placement is **not** healed by anything else: trial 2's fight sat at `status 0`, expired, for
15.6 minutes with no client attached and no janitor touching it.

## Teardown

Both fights settled through the product's own FORFEIT door (`logs/pr966_settle1.log`,
`logs/pr966_settle2.log`) — `/v1` `gone`, object destroyed. `/v1/fights?character=…` returns `{"fights":[]}`.
No transaction was ever retried after an executed failure.

Spend: `1.832400468` → `1.693782120` SUI = **0.138618 SUI** (ceiling 0.3).

## Replay

`rigs/` holds the exact scripts. From the lane worktree with the dev server on `:5310`:

```
node rigs/pr966_roam_engage.mjs                 # bars 1 · 2 · 4 · 5
FIGHT=0x… node rigs/pr966_bar3.mjs              # bar 3, against an expired-placement fight
FIGHT=0x… NAME=… node rigs/pr966_settle.mjs     # teardown via the product forfeit flow
```

`pr966_harness.mjs` carries the seat/console capture, the raw-JSON `chain_read` (no bare specifiers — the
browser cannot resolve `@aresrpg/sdk/fight`; live-instance state comes from `window.__ARES_DEV_STATE`), and
the bar-4 `RELEASE_SIGNALS` watchlist.
