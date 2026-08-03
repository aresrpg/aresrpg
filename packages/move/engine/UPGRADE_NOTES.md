# Engine upgrade — COMBAT INTEGRITY (2026-07-13)

`aresrpg_fight` package upgrade closing two owner-found exploits. **This is a COMPATIBLE package upgrade, not a
republish** — body-only edits to existing entry/public functions + purely additive functions, structs, constants,
and dynamic-field state. No public/entry signature changes; no struct-layout changes. Tonight's full seed and every
live fight survive the upgrade.

## What changed

### 1. Minimum turn duration (instant-pass bot guard)

`turn_ms` was a max-timeout only, so a bot could pass its turn in 0 ms. `actions::act_pass` now asserts the turn
has lasted at least **`MIN_TURN_MS = 3_000`** before the pass commits — a player takes a minimum of 3s to
play their turn, enforced contract-side.

- Turn START is derived, not stored: `turn_started = turn_deadline_ms − turn_ms` (`resolve_from` stamps
  `deadline = start + turn_ms` at every turn start). The check is written `now + turn_ms >= turn_deadline_ms +
MIN_TURN_MS` so it can never underflow.
- **MOB waves + the crank are exempt by construction, not by a flag.** Mob turns resolve _inside_
  `turns::resolve_from` and never route through a pass; the permissionless overdue `crank` gates on the OPPOSITE
  end (`now >= turn_deadline_ms`). The gate lives in `act_pass` alone, so neither is ever throttled.
- `turn_ms` is config-clamped to `[5_000, 300_000]` (default 45_000), so the `[MIN_TURN_MS, turn_ms]` play window
  is always non-empty.

### 2. Cast limits (cooldown / casts_per_turn / casts_per_target) — display made honest

`spell_template` stored per-level `casts_per_turn / casts_per_target / cooldown_turns` (+ getters) and the HUD
displayed them, but the engine enforced **nothing** cross-turn: the old `resolve_player_cast` check compared the
level's `casts_per_turn` against the _shared_ per-turn action counter (`participant::casts_this_turn`, which weapon
strikes also increment and which resets every turn) — so cooldowns and per-target caps were unenforced and
per-turn was conflated. Owner repro: cast a cooldown-4 invisibility **every** turn.

`cast::resolve_player_cast` now enforces all three, per caster, via `enforce_and_record_cast`. The old
shared-counter check is removed; `casts_this_turn` remains untouched as the §7 crit **slot index** (weapon strikes
still share it — the sim's `turn_seed.js` parity is unaffected).

- **Cooldown** `C`: recastable only when `current_turn − last_cast_turn > C` (matches the brief's formula). `C = 0`
  ⇒ no cooldown. Because the clock is the caster's own turns, a `C > 0` spell is at most **once per caster turn**
  (the 1.29 relaunch interval; a same-turn recast has `current − last = 0 !> C`). This makes the HUD's
  "Cooldown: N turns" chip literally true.
- **casts_per_turn**: ≤ N casts of THIS spell per caster turn (`255` = unlimited).
- **casts_per_target**: ≤ N casts of THIS spell at the SAME target **cell** per caster turn (`255` = unlimited).
  Targets are identified by `target_cell` (the resolver's unit of targeting); authored on 18 corpus levels today.

Enforcement runs after the read-only gates (class / AP / `can_cast_at`) and **before** any effect write, so an
over-limit cast reverts whole. Spells with no authored limit (unlimited + cooldown 0 — the common case, 1158/1656
levels) touch **zero** dynamic fields.

## Dynamic-field state (the upgrade-safe channel — `Participant` layout is frozen)

All new state lives as dynamic fields on the `Fight` UID (`fight::uid`/`uid_mut`), keyed by **seat** (stable for
the fight's life — seats are append-only, never reused). Per-turn counters reset **lazily** by comparing a record's
`last_turn` to the caster's current turn (no turn-start sweep).

| Key (`cast.move`)                 | Value                                       | Purpose                           |
| --------------------------------- | ------------------------------------------- | --------------------------------- |
| `SeatTurnKey { seat }`            | `u64`                                       | caster's OWN turn counter (clock) |
| `CastKey { seat, spell }`         | `CastRecord { last_turn, casts_this_turn }` | cooldown + casts_per_turn         |
| `TargetKey { seat, spell, cell }` | `TargetRecord { last_turn, casts }`         | casts_per_target                  |

The clock (`SeatTurnKey`) is bumped once per PLAYER turn-start in `turns::resolve_from` (`cast::note_seat_turn`).
Each living seat takes exactly one turn per round, so it numerically equals @aresrpg/sim's per-round `turn_number`
for every caster. At settlement the Fight is `object::delete`d — leftover cast-history DFs are **orphaned without
abort** (verified: `sui::object::delete` performs no DF-emptiness check); they are ephemeral per-fight dust, and
`settle_mints_results_and_destroys` stays green.

## Abort codes (new)

| Module                   | Code | Constant           | Meaning                                                  |
| ------------------------ | ---- | ------------------ | -------------------------------------------------------- |
| `aresrpg_fight::actions` | 108  | `ETurnTooFast`     | pass before `MIN_TURN_MS` elapsed                        |
| `aresrpg_fight::cast`    | 105  | `ESpellOnCooldown` | last cast of this spell still inside its cooldown window |
| `aresrpg_fight::cast`    | 106  | `ECastsPerTarget`  | already hit this target cell `casts_per_target` times    |

`aresrpg_fight::cast` code **103 `ECastsPerTurn`** is reused (now the proper per-spell cap; formerly the buggy
shared-counter check).

### ⚠ Frontend humanization gap (out of scope per constraints — REPORT, do not fix here)

`packages/frontend/src/game/core/abort_copy.js` has **no `cast` module arm** (only a legacy `dungeon_cast` arm),
and its `actions` arm lacks code 108. So `ESpellOnCooldown`/`ECastsPerTarget`/`ECastsPerTurn`/`ETurnTooFast` will
fall through to the generic "failed on-chain" toast until a `cast` arm (101–106) and `actions.108` are added. Copy
already exists for the meaning (`errors.spell_cooldown`). Recommend a follow-up frontend ticket.

## Sim parity disposition — NO change (evidence-backed)

The `packages/sim` `reduce()` combat loop is **not** the on-chain-fight predictor and does **not** mirror the
chain's cast rules, so there is nothing to keep in sync here:

- The live frontend fight module (`game/core/modules/fight.js`) imports only `normalize_spell_templates` from
  `@aresrpg/sim` (a pure display helper) and renders the authoritative chain event stream — "it never computes
  combat truth". `reduce` / `create_fight_state` / `handle_cast` / `process_spell_cast` are **unused anywhere
  outside `/sim/`** (grep-confirmed across frontend + sdk + rpc).
- The sim's cast model is a legacy koshi-2d **hand/deck** card game (`current.hand.includes`, `discard_spell`,
  draw) with no cooldown counter — a structure the chain has never had. Bolting turn-based cooldown/per-target
  asserts onto it would enforce rules into an unused, already-divergent model, not achieve parity.
- The sim pieces that ARE pinned chain mirrors — `turn_seed.js` (crit-slot parity), prng, pathfinding, targeting
  geometry — are untouched by this diff (the crit slot index `casts_this_turn` is unchanged).
- The fight HUD shows only the **static** cooldown value ("N turns"); there is no live cooldown countdown / grey-out
  to keep in sync. Enforcement simply makes that displayed number true.

If a future ticket reconciles the sim's cast model with the chain, cooldown/cast-limit prediction belongs there.

## Ceremony (the lead fires this after the money hat — DO NOT run it here)

Compatible upgrade via the SDK path (`ceremony_upgrade.mjs` — authorize → upgrade → commit; refuses unless the
localnet gate is green; upgrades cannot be dry-run). Signer = ambient active-address, signer-gate-asserted
(`scripts/ceremony-signer-gate.sh pre`; expected identity per DECISIONS 2026-07-18 15:03 = `server-aresrpg`;
never a personal key). `PACKAGE_ID` is
the engine TYPE-ORIGIN id (`ENGINE_PACKAGE_ID`); the run bumps `ENGINE_LATEST_PACKAGE_ID` — restamp the SDK
deployment after.

```bash
scripts/ceremony-signer-gate.sh pre   # asserts env==testnet AND active-address==server-aresrpg before any tx
UPGRADE_CAP=<engine UpgradeCap objectId> \
PACKAGE_ID=<ENGINE_PACKAGE_ID (type origin)> \
PKG_PATH=packages/move/engine \
  node packages/move/scripts/ceremony_upgrade.mjs   # signer = ambient active-address (PRIVATE_KEY env = explicit override only)
```

After success: stamp the new `ENGINE_LATEST_PACKAGE_ID` into `packages/sdk/src/deployment/aresrpg.js` and reconcile
`Published.toml`.

## Verification

- `sui move test` (engine): **122 passed / 0 failed** (114 baseline + 8 new in `combat_integrity_tests.move`).
- New cases: pass-before-3s aborts · pass-after-window succeeds + mob wave resolves unthrottled · cast within
  cooldown aborts · cast after cooldown succeeds (DF survives across turns) · casts_per_turn cap aborts · per-turn
  resets next turn · casts_per_target cap aborts · casts_per_target is per-cell.
- `sui move test` (aresrpg core, the engine's consumer): unchanged count, still green.
