# Sword refusal — fight 0x570b7484e6c3d31a1ede67c149912d88f00388d20962ab6843812d5d8ae9fc98

Capsule: `aresrpg-fight-trace-0x570b...9fc98-1785128087490.json` (trace_format 1, app v1.13.0,
353 inputs, captured_at 1785128087490). Replayed through `create_fight_store()` + `input(msg, at)`
per `packages/fight/src/trace_recorder.js` (the same door `packages/fight/test/trace_512_replay.test.js`
uses). Probes kept in the lane: `probe1.mjs` (fold state at each click), `probe2.mjs` (client-vs-chain
weapon castability diff), `probe3.mjs` (armed_spell_id transitions).

## VERDICT — ② the client legality gate is WRONG vs the chain, but the bug is NOT in packages/sim

`packages/sim` is provably correct here (`find_entity_at` filters `health > 0`, a fresh scan —
`packages/sim/src/fight_state.js:174-181`), and the chain never refused anything (every receipt in the
capsule is `status: "success"`; no abort code appears). The wrong gate is a **client occupancy
projection** in `packages/frontend/src/game/screens/hud/world/DungeonBoard.jsx` — outside this lane's
fence, so nothing was changed. Finding only.

## SYMPTOM (from the fold, not from inference)

Three consecutive refusals, all in the owner's turn 3, all on cell 26:

| input idx | trace seq | event | armed after |
|---|---|---|---|
| 228 | 834 | `arm __weapon_attack` | `__weapon_attack` |
| 231 | 837 | `board_click cell 26 targetable:false` | **null** (silent disarm) |
| 243 | 849 | `arm __weapon_attack` (he re-armed) | `__weapon_attack` |
| 246 | 852 | `board_click cell 26 targetable:false` | **null** |
| 254 | 860 | `arm __weapon_attack` (re-armed again) | `__weapon_attack` |
| 259 | 865 | `board_click cell 26 targetable:false` | **null** |
| 306 | 912 | `arm death_mark` | `death_mark` |
| 310 | 916 | `board_click cell 26 targetable:TRUE` → cast lands on mob-1 | staged |

The disarm is `packages/fight/src/store.js:1042` (`armed ∧ ¬targetable ⇒ disarm`) — correct behaviour
fed a wrong verdict. Same cell, same turn, same position, ~50 inputs later: **death_mark was legal on
cell 26 and the weapon was not.**

## PER-TURN WEAPON CASTABILITY LEDGER (committed truth at each weapon-armed board_click)

Weapon (chain escrow row): `ap_cost 4, reach 1, damage 18`. Cell stride `GRID_W = 20`
(`packages/sim/src/combat_grid.js:21`), so `manhattan(6, 26) = 1`.

```
idx 34  turn 1  me@cell 3  ap 6/6  mp 3  casts_this_turn 0  cooldown n/a  cast_path []
        mobs: m0@23 hp30 ALIVE · m1@86 hp10 ALIVE · m2@66 hp16 ALIVE
        client castable {23}   chain-legal {23}   AGREE  → cast landed
idx 145 turn 2  me@cell 6  ap 6/6  mp 3  casts_this_turn 0  cooldown n/a  cast_path []
        mobs: m0@23 hp0 DEAD · m1@86 hp10 ALIVE · m2@26 hp16 ALIVE
        client castable {26}   chain-legal {26}   AGREE  → cast landed, m2 hp 16→0 (KILL, corpse left at 26)
idx 231 turn 3  me@cell 6  ap 6/6  mp 3  casts_this_turn 0  cooldown n/a  cast_path []
        mobs: m0@23 hp0 DEAD · m1@26 hp3 ALIVE · m2@26 hp0 DEAD   ← two mobs share cell 26
        client castable {}     chain-legal {26}   DIVERGE → REFUSED + silent disarm
idx 246 turn 3  (state identical to 231)                          DIVERGE → REFUSED
idx 259 turn 3  (state identical to 231)                          DIVERGE → REFUSED
```

Every legality axis at idx 231 says CASTABLE:
- **AP**: 6 available ≥ 4 cost. ✔
- **Range**: `manhattan(6, 26) = 1`, weapon reach 1, `1 ≤ d ≤ reach`. ✔
- **LOS**: distance 1, both endpoints self-excluded. ✔
- **Cast limits**: the weapon has no `casts_per_turn` / `casts_per_target` / cooldown
  (`cast.move:656-658` — "Repeatable while AP lasts, no per-turn cap"); `casts_this_turn = 0`,
  `cast_path` empty. ✔
- **Turn**: `my_turn true`, `busy false`, `presenting false`, `cast_presenting false`. ✔
- **Living target on the cell**: mob-1, hp 3, `alive: true`, `invisible: false`. ✔

## WHICH GATE REFUSED, AND WHY

`DungeonBoard.jsx:330-335` builds occupancy as a **cell-keyed Map, last write wins**:

```js
dungeon.mobs.forEach((m, i) => map.set(m.cell, { kind: 'mob', alive: m.committed?.alive ?? m.alive, idx: i }))
```

A dead mob keeps its `cell` on chain, and corpses do not body-block, so a live mob may legally walk
onto a corpse's cell. When that happens the **higher-index occupant overwrites the lower one**. Here
mob-2 (dead, idx 2, cell 26 — the corpse of the owner's OWN idx-145 kill) overwrote mob-1 (alive,
idx 1, cell 26). The weapon branch then reads one occupant per cell:

`DungeonBoard.jsx:477-484`
```js
for (const [cell, o] of occupied) {
  if (o.kind !== 'mob' || !o.alive) continue   // ← cell 26 dropped: the Map says "dead mob"
```

so cell 26 never enters `castable`, the click reports `targetable:false`, and the store disarms.
`death_mark` took the *spell* branch (`cast_range_set_dungeon`, pure geometry, occupancy-agnostic),
which is why the identical cell was castable for a spell and not for the sword.

**Twin citation.** Chain: `packages/move/engine/sources/cast.move:678` → `find_living_mob_at`
(`cast.move:808-817`) — a fresh scan that returns the first mob with `is_alive(m) && cell(m) == cell`;
corpses can never shadow a living target. Sim: `packages/sim/src/fight_state.js:174-181`
`find_entity_at` — same fresh scan, `health > 0`. Client: `DungeonBoard.jsx:334` — a collapsed
one-occupant-per-cell Map. Two of the three authorities scan; the client memoizes a lossy index.

## MECHANICAL PROOF (probe2.mjs)

Replaying the capsule and computing, at every input, the weapon-castable set twice — (A) the client's
`occupied`-Map algorithm, (B) the chain's `find_living_mob_at` scan — the two agree for the first 191
inputs and diverge from input **192 onward for the remaining 155 of 350 inputs**. The divergence opens
the instant the fold applies the receipt at input 191 (trace seq 797), which lands mob-1 on cell 26 —
the corpse cell mob-2 left at input 145.

```
FIRST DIVERGENCE  idx 192  turn 3  me@6  ap 6
  client {}   chain {26}
  mobs: [{i:0, cell:23, hp:0, alive:false}, {i:1, cell:26, hp:3, alive:true}, {i:2, cell:26, hp:0, alive:false}]
```

Had the chain's mob array ordered these two the other way round, the sword would have worked — which
is exactly why this reads as "at some point" rather than "always".

## SECONDARY DAMAGE FROM THE SAME COLLAPSE (same `occupied` Map, other readers)

1. **LOS blockers too permissive** — `DungeonBoard.jsx:431` pushes a blocker only
   `if (o.alive && c !== me.cell)`. A live mob shadowed by a corpse is *not* pushed, so a target
   standing behind it lights as castable and the chain then aborts `EIllegalCast` (LOS). This is the
   inverse-direction bug of the sword refusal, from the identical line.
2. **Target readout lies** — `DungeonBoard.jsx:760` `committed_target_alive` resolves `tgt.idx` (= 2,
   the corpse) and reads the corpse's hp, so the hover/prediction panel describes the dead mob.

## THE FIX (not applied — outside this lane's fence)

`occupied` must stop being a lossy index of a stacked cell. Minimal shape: a living occupant always
wins its cell (a corpse only fills a cell no living occupant claims), i.e. in the `dungeon.mobs`
forEach, skip the write when the incoming occupant is dead and the cell already holds a living one —
and, for exactness, resolve the alive one when both exist rather than "last index wins". That makes
the client's per-cell verdict equal `find_living_mob_at` for every stacked cell, which is the property
the chain, the sim and the client must share.

RED artifact for that fix: two mobs on one cell, indices ordered dead-after-alive, caster at reach 1
with AP ≥ weapon ap_cost — assert the cell is in the weapon `castable` set. The state is already
distilled above (me@6 ap 6; m1@26 hp 3 alive; m2@26 hp 0 dead; weapon reach 1 ap_cost 4) and does not
need the 399KB capsule.

## Also worth a ticket (independent of the fix)

Even a *correct* refusal is mute today: the click silently disarms with no reason surfaced. The owner
re-armed the sword three times because nothing told him why. The refusal reason is fully derivable at
the gate (out of range / not enough AP / no living target / on cooldown / per-target cap) — the HUD
has everything it needs to say it.
