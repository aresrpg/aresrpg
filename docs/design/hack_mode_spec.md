# HACK MODE — retrowave flat-grid world presentation (design spec)

Owner order (verbatim, the constitution): _"add a new setting in the setting page 'hack mode',
which disable the gpu terrain and replace it by a simple cyberpunk flat grid, with a retrowave
sun, basically since on-chain the terrain doesn't matter and mobs/gatherable are just x,z we can
also show a simple grid with nice retrowave style and colors to let pro player not be bothered by
the real terrain."_

Riders (same hour): ① hack mode is also the **driven-QA rail's default world** — armable without
UI, deterministic navigation, a stated QA contract; ② position **visibility is mode-scoped**
(hack players render for hack players; the two presentations never spatially interact) while
**presence is universal** (the chat online count is mode-blind, unchanged).

---

## 0. TL;DR

Chain truth is x,z. Terrain height is client decoration. Hack mode swaps the **world
presentation** inside the ONE engine factory — a third presentation the same way ENG-20 already
forks a whole alternate renderer (`create_webgl_engine`, `packages/engine/src/engine.js:393-394`)
and the synthetic bench path already boots the WebGPU stack **with no streaming ring at all**
(`engine.js:817-827`, `ring_manager` nullable end-to-end). Every gameplay system keeps consuming
the same oracle surface (`sample_block` / `sample_block_analytic` / `is_column_resident` /
`ground_surface_y(sample,…)`), which in hack mode answers a **constant plane**. Nothing outside
the seam ever branches on the mode.

- Engine: `create_engine({ …, presentation: 'hackgrid' })` — skips gen/mesh/far workers, ring,
  far shell, water, falls, ambience, atmosphere; mounts a neon grid plane + retrowave sky; the
  collision/residency oracle becomes `y < 138 ⇒ solid`, `is_column_resident ⇒ true`.
- Frontend: one settings toggle (default OFF), persisted like its siblings, applied **live** via
  the existing `reboot_voxel_session_tier` idiom (no page reload; fight-blocked with the same
  toast as a quality swap). `?hack=1` URL override for QA (the `?v2shadow` + engine-flags
  precedence precedent).
- Multiplayer: one broadcast bit (`hack`) rides the existing low-frequency `state` payload; the
  existing receiver-side render-instance filter gains a hack axis. Presence/online count is
  untouched by construction (it never reads render filters).

---

## 1. Architecture — the one seam

### 1.1 What "terrain" provides today (the three roles, mapped)

| Role                          | Where it lives today                                                                                                                                                                                                                                                                                                                  | Hack-mode answer                                                                                                                                                                                                                                                                                   |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| (a) Rendering                 | WebGPU init in `create_engine`: gen/mesh pools + ring (`engine.js:829-908`), far shell (`engine.js:953-1007`), materialization floor (`engine.js:918-921`), waterfalls (`engine.js:784-791`), ambience particles (`engine.js:737-747`), atmosphere/Hillaire sky (`core/renderer.js:702-731`), underwater pass (`engine.js:1213-1220`) | None of it is constructed. A new `render/hack_grid.js` mounts the grid plane + retrowave sky into the same `renderer_handle.scene`.                                                                                                                                                                |
| (b) Ground height / collision | `sample_block` (`engine.js:1392-1395`), `sample_block_analytic` (`engine.js:1396-1409`, analytic fallback via `world_surface_y`), `is_column_resident` (`engine.js:1411-1414`). The app composes them once (`embed_voxel.js:352-362`) and EVERY consumer goes through that closure or `engine.sample_block`                           | The hack branch overrides these three api methods with the flat oracle: solid iff `y < HACK_GROUND_Y`, resident always. This **is** the deep height-source swap — one home, every consumer (controller, physics gate, boot veil, entity grounding, board seating, rescue nets) inherits the plane. |
| (c) Spawn/anchor math         | `@aresrpg/sim` `zone_derive.js` — pure seeded PRNG over the zone box, **x,z only** (verified: no height term anywhere in the derivation); entity Y is always re-derived client-side from the sampler (`ground_surface_y(sample, x, z)`)                                                                                               | Untouched. Height independence is already a fact; the plane Y falls out of (b).                                                                                                                                                                                                                    |

### 1.2 The engine seam (the RECIPE-level fork, not scattered ifs)

`create_engine` gains one option:

```
@property {'terrain'|'hackgrid'} [presentation]  world presentation; default 'terrain' (today's world)
```

Inside `init()` (the WebGPU path — hack mode requires WebGPU because the tactical board, avatars
and fight VFX are TSL; on the WebGL floor the option is ignored with one warn, exactly how the
board is an ENG-20 no-op there):

- Everything **before** the fork stays: `set_gen_config(world_config)` (`engine.js:361`) still
  runs with the REAL world recipe, so the pure-gen consumers that are _map truth_, not
  presentation — region music (`world_region_at`), `world_minimap_column`, `world_biome_at` —
  keep answering about the real world. The gen side is unchanged; what changed is the HUD's use
  of it: the minimap renders the lattice in hack mode and never calls `world_minimap_column`
  (A1, §10 — this paragraph originally said it deliberately kept showing the real terrain map).
- At the `is_synthetic` construction fork (`engine.js:817`), a `hackgrid` presentation takes a
  third branch: **no** gen_pool / mesh_pool / ring_manager / materialization_floor / far_field /
  far_pool / far_streamer. `terrain_renderer` **is still created** (`engine.js:749-765`) — zero
  chunks ever upload in the overworld (≈zero steady cost), but the cave dungeon room uploads
  through this same seam (`get_terrain_renderer`, `engine.js:1445-1451`), so dungeons keep
  rendering their carved room unchanged inside hack mode.
- `ambience` and `falls` construction is skipped in the hack branch (they are terrain/biome
  decoration); `mana_barrier` **stays** (the world fence is gameplay; its terrain-following
  `ground_at` probe in `arm_border` (`engine.js:568`) reads the presentation oracle's constant
  instead of `world_surface_y` — flat wall base, correct by construction).
- The frame loop body (`engine.js:1014-1254`) needs **no hack branches**: every terrain system it
  drives is already null-guarded (the synthetic path proves it). One addition in the same
  null-guard style: `hack_presentation?.tick(dt)` for the sky/grid shader clock.
- Boot signals: with no ring, the hack branch emits `load_progress` `focus_ready` →
  `visual_ready` → `done` immediately after the renderer is up (after running the same D221
  pipeline pre-warm so avatar/VFX pipelines still compile behind the veil). The app's boot veil
  then clears synchronously (`embed_voxel_boot.js:78-81` — `is_column_resident` answers true at
  veil creation) and the physics gate opens on frame 1 (`embed_voxel.js:661-700` +
  `spawn_column_gate.js:21-26`).

### 1.3 The height source (the deep seam), pinned

```
HACK_GROUND_Y = 138            // the FEET plane; solid iff floor(y) < 138 ⇒ ground block top face at y=137
sample_block(x,y,z)          = floor(y) < 138 && in [0, WORLD_HEIGHT) ? ANALYTIC_GROUND_ID : 0
sample_block_analytic        = same (no residency concept)
is_column_resident(x,z)      = true
arm_border ground_at(x,z)    = 137
```

Why 138: `WORLD_SPAWN = [3.5, 138, 4.5]` (`embed_voxel.js:99`) — the default boot pose stands
exactly on the plane, so no rescue/snap path ever fires on a fresh boot. `ground_surface_y`
(the shared `@aresrpg/engine3/player` scan every entity/rig/board consumer already uses) returns
137 for every column; `feet_of` puts every entity at y=138. The zone fence stays the existing
±`DEFAULT_WORLD_OFFSET` (250 000) box (`embed_voxel.js:210-215`) — unchanged.

The cave override is untouched: in a dungeon, `cave_sample` swaps over the world sampler
(`embed_voxel.js:354-356`, D211) exactly as today — hack mode only owns the _overworld_ oracle.

### 1.4 The sky/atmosphere seam

- `create_renderer` (`core/renderer.js`) gains one option `atmosphere: false` — it forces the two
  **existing** degradation paths: no Hillaire sky (the LOW/analytic ladder rung,
  `renderer.js:702, 728-731`) and no atmosphere post (`atmo = null` — every consumer already
  handles null: `engine.js:1460-1465`). No new null-handling anywhere.
- The hack branch then swaps `renderer_handle.scene.backgroundNode` (the seam the analytic sky
  already owns, `renderer.js:681`) for the retrowave sky node from `hack_grid.js`.
- Scene fog is **not** fought: hack materials (grid, sky) are fog-immune (material-level fog
  opt-out) and do their own distance fade in-shader. Rationale: cave enter/exit already drives
  `set_fog_scale(0)`/`(1)` (`engine.js:1488-1494`, D213-B) — a hack-owned fog_scale would be
  clobbered on every dungeon exit; opting the materials out sidesteps the shared dial entirely.
- No shadow pass interaction: the grid is unlit/emissive (house law: board overlays unlit); the
  sun shadow map still exists for entities but has no terrain casters — near-zero cost. Entities
  keep their normal lit look standing on the dark grid.

### 1.5 The frontend seam (composition root, not branches)

`create_session` (`embed_voxel.js:133`) resolves the mode ONCE beside the biome recipe resolve
(`embed_voxel.js:174-186`) and passes `presentation` to both `create_engine` calls
(`embed_voxel.js:200-202`). Two composition-level selections, both at the mount root:

- `presentation: hack ? 'hackgrid' : 'terrain'` (spectate boots are **excluded** — the login
  backdrop stays the scenic terrain vista; hack is a player preference for played sessions,
  resident + follow).
- `world_props` (decorative FlameFX camps, `embed_voxel.js:555`) are not created in hack mode —
  pure decoration, and "not be bothered" means a clean grid.

Everything else in the session (controller, player, remotes, world_spawns, fights discovery,
board, adapter, cave, cameras) is composed identically and consumes the oracle.

Live apply: the toggle rides the exact `apply_wireable_flag` machinery
(`game/screens/hud/world/engine_flags.js:43-56`) — persist, then `reboot_voxel_session_tier`
(`embed_voxel.js:1067-1083`) re-creates the session in place behind the boot veil (~1-2 s, no
page reload; in hack mode the veil never even paints). A live dungeon/fight refuses the swap,
reverts, and toasts `world.quality_fight_blocked` — the established honest path. No new
reload machinery, no "requires reload" caveat.

---

## 2. The visual spec

The WORLD is retrowave by design; the SETTINGS UI stays gothic terminal.

### 2.1 Palette

The complete sRGB colour vocabulary lives in `HACK_PALETTE`
(`packages/engine/src/render/hack_palette.js`), the shared source of truth consumed by both the
world grid and HUD minimap. Consult that module for the current keys and hex values.

Colors are authored knowing the AgX grade still runs in post — pick saturated bases; verify on
the shipped MEDIUM taau pipeline, not raw.

### 2.2 Layout (ASCII level)

```
        #05010d ────────────────── zenith
            ▲ vertical gradient
        #2b0a4a ────────────────── mid sky
      ━━━  ████  ━━━               retrowave sun: circular disc, gradient #ffd319→#ff2975,
      ━━ ██████ ━━                 3-4 horizontal gap stripes in the lower half, subtle bloom halo;
        #ff6ec7 ────────────────── FIXED position: azimuth NORTH (+Z), low elevation (~6° above
   ═══════════════════════════════ horizon) — a standing navigation landmark, never animated
   ┼──┼──┼──┼──┼──┼──┼──┼──┼──┼──  grid plane at y=137 (top face): minor cyan lines on the 1 m
   │  │  │  │╔═╗│  │  │  │  │  │   block lattice, MAJOR magenta lines every 8 m; lines fade
   ┼──┼──┼──┼╚═╝┼──┼──┼──┼──┼──┼   toward #2b0a4a past ~400 m (in-shader distance fade, no fog)
              └─ entities: normal models/nameplates at their true x,z, feet at y=138
```

- **The grid IS the interaction grid**: minor lines sit on the integer block lattice — the same
  1 m lattice `zone_derive` positions, gather cells, and movement snap to. Major lines every
  8 blocks give distance legibility. (Fight boards mount their own 1.33 m-cell surface + overlays
  on top, unchanged — the two grids never conflict because the board draws its own opaque
  surface.)
- The plane is ONE large static mesh centred on the camera in 2 or 3 rings (near detailed
  shader-grid quad ~600 m + a far solid-color skirt to the horizon), shader-derived lines from
  world-space coords (no textures, no streaming, resolution-independent, anti-aliased in TSL).
  Slow atmospheric motion allowed: a faint scanline shimmer on the major lines (house DNA: slow
  atmospheric motion) — subtle enough that QA probes ignore pixels anyway (§3).
- Entities (mobs, players, gatherables, NPCs, fight sword, spawn cards) render exactly as today —
  same models, same nameplates/prompts/HUD. Gather glow/props ground on the plane via the oracle.
- The mana-barrier wall + banner stay as-is (gold/cyan holo reads perfectly on this palette).
- Settings UI: a standard `ToggleRow` in the existing render-options panel — gothic terminal
  tokens, uppercase micro-label, no retrowave styling bleed into the settings page.

---

## 3. The QA contract (what a driver may assume in hack mode)

Hack mode is the driven-QA rail's default world. A Playwright driver may rely on ALL of the
following as **contract**, not incidental behavior (each is pinned by the architecture above and
asserted by the e2e slice):

1. **Arming without UI**: `?hack=1` in the URL (always wins, the engine-flags PRECEDENCE LAW,
   `engine_flags_pref.js:8-12`) or `localStorage['aresrpg.hack_mode_enabled'] = '1'` before boot
   (the dual-spelling precedent every engine flag follows). No clicks needed; a fresh context +
   `addInitScript` is enough.
2. **Constant ground**: for every in-fence x,z — `engine.sample_block(x, y, z)` is solid iff
   `floor(y) < 138`; `ground_surface_y(sample, x, z) === 137`; every standing entity's feet
   y = 138. No water, no trees, no cliffs, no caves (overworld).
3. **Instant readiness**: `is_column_resident → true` from boot; the blur veil clears
   synchronously; physics + input are live on the first frame after renderer boot. No streaming
   waits, no `focus_ready` polling, no entombment/under-map/floor-net rescues can fire.
4. **Deterministic navigation**: a straight-line x,z walk between any two in-fence points always
   succeeds — zero terrain collision, zero stuck-in-trees, no degenerate steering bases. The only
   movement constraints are the zone fence (±250 000) and a fight freezing the controller.
5. **Entities at true x,z**: every mob group / gatherable / remote player renders at its chain or
   broadcast x,z on the plane; screen-space picking targets are never terrain-occluded (board
   occlusion still handles fight-board framing).
6. **Legible interaction grid**: minor grid lines = the 1 m block lattice (a driver can reason
   "one line = one block").
7. **Probes over pixels**: assert via the live dev hooks and engine API (`__voxel_ctl.get_transform()`,
   `__voxel_engine.get_stats()`, `get_active_world_config()` — the `hack_live_swap.spec.ts`
   idiom), never pixel-diffing (entity idle anim + grid shimmer make pixels non-deterministic by
   design).
8. **The minimap is hack-mode too** (A1, §10 — this line originally said it still showed the
   real terrain map): both the small map and the expanded modal render the lattice and probe no
   terrain, so a driver may assert zero `world_minimap_column` calls, never real-map pixels.
9. **NOT covered**: dungeons still render their cave room; cross-mode players are intentionally
   invisible (§4); spectate ignores hack mode.

---

## 4. Multiplayer — mode-scoped visibility, universal presence

### 4.1 The one broadcast home for the mode bit

> **CURRENT (#1698).** The mode bit rides the low-frequency room `state` payload
> (`src/p2p/lobby-room.js` → `presence_input` → the presence atom). §4 is still UNBUILT, so nothing
> here has been built yet — but when it is, the bit's one home is that `state` payload, never a
> second channel. §4.2's receiver-side filter and §4.3's mode-blind presence hold unchanged. Two
> touches remain:

- the mode bit joins the room `state` payload for the session (the pref module stays the SSOT; a
  toggle flip reboots the session, so the bit re-publishes automatically — no extra wiring).
- the presence fold whitelists it: `hack: !!input.hack` (`packages/world/src/presence.js`).
- Positions keep flowing **universally and unchanged** (`publish_room_position`, `p2p/lobby-room.js`
  — it is also the liveness heartbeat; forking it would fork presence).

### 4.2 Visibility is a RECEIVER-SIDE render filter (the smaller design, per the rider)

Rendering already routes every spawn/despawn decision through ONE predicate:
`same_render_instance` (`game/remote_visibility_scope.js:22-28`), fed by `peer_scope`
(`game/remote_players.js:251-259`) — the D237 instance-scope precedent (dungeon peers never
render cross-instance while their presence keeps flowing). Hack mode is one new axis on that
exact scope object:

```
same_render_instance({ …, mine_hack, peer_hack }):
  both overworld  → require mine_hack === peer_hack   (grid people see grid people)
  dungeon branch  → unchanged (the cave room is its own presentation; party co-op law holds)
```

`peer_scope` reads `mine_hack` from the pref module and `peer_hack` from the peer's presence row
(`presence_character(id)`, `world-shell/presence_adapter.js`). An unknown peer (`hack` absent) folds
to `false` = terrain — an un-upgraded client degrades to exactly today's behavior. The GUARDRAIL
binds: no per-mode rooms, no sender-side selective announce — receiver filter only.

Cross-mode spatial non-interaction follows: a terrain player's model (with terrain-height `h` in
its pos packets) never renders in the grid view, and a grid player (h=138) never renders on
terrain — the mismatched-height ghost problem never materializes because the rigs never mount.

### 4.3 Presence is mode-blind — proven, not promised

The chat online count reads `select_online_count` (`game/core/presence_count.js:7`) =
`visible_characters.size + 1`, fed by the presence atom's peer table off `pos`/`state`
liveness — the SAME table that already includes cross-dungeon peers the render filter drops
(`remote_players.js:222-245` documents this exact split). The mode bit lives only in the peer
row + the render predicate; no presence fold, expiry clock, or count selector reads it. The
existing `presence_count_ssot.test.js` is extended with a hack-bit row to pin it mechanically:
a peer with `hack: true` and mine `false` still counts.

Chat, party invites, dungeon shares, commissions, friends-online: all ride `state`/`chat`
channels that never consult the render filter — untouched by construction.

---

## 5. Performance — what hack mode skips (named)

Never constructed (not "hidden" — zero cost):

| System                                                             | Anchor                                      |
| ------------------------------------------------------------------ | ------------------------------------------- |
| gen worker pool (2 workers, ~450 MB RSS class each)                | `engine.js:829-842`                         |
| mesh worker pool (≤6 workers) + all main-thread mesh slicing       | `engine.js:851-856`                         |
| streaming ring: gen requests, meshing, GPU uploads, per-frame pump | `engine.js:857-908, 1039-1056`              |
| far shell + far worker + far streamer + residency mask             | `engine.js:953-1007, 1079-1099`             |
| materialization floor + reveal front driving                       | `engine.js:918-921, 1048-1055`              |
| waterfall system                                                   | `engine.js:784-791`                         |
| ambient particle director                                          | `engine.js:737-747`                         |
| underwater sampling/pass work                                      | `engine.js:1213-1220`                       |
| Hillaire sky + clouds/froxels/god-rays post                        | `renderer.js:702-731` (`atmosphere: false`) |
| terrain/water/flora draw calls (quad pool stays empty)             | no uploads ever                             |

Kept (correctness/feature): WebGPU renderer + post (AgX/taau), pipeline warm queue + fight-VFX
prewarm, tactical board + occlusion uniforms, avatars/mob models/cosmetics, mana barrier, cave
dungeon path (incl. the terrain_renderer seam + atlas bake — the one retained boot cost, needed
the moment a dungeon opens), DOM plates/prompts/HUD, region music (pure gen math — the minimap
no longer rides it in hack mode, A1 §10; it renders the lattice and probes nothing, which is a
perf win on top of this list, not a kept cost).

Expected effect: draw calls drop from thousands (terrain quads) to dozens (entities + grid +
board); zero streaming main-thread cost; ~1 GB+ renderer-process RSS headroom from the absent
gen/far worker realms; time-to-play ≈ renderer boot. The e2e slice records `get_stats()`
(fps / draw_calls / resident_chunks=0) as the honest measurement.

---

## 6. The setting — spelling, persistence, i18n

- **Pref module**: extend `game/screens/hud/world/engine_flags_pref.js` (the graduated-flags
  home): `HACK_MODE_STORAGE_KEY = 'aresrpg.hack_mode_enabled'` (default **OFF**),
  `get_saved_hack_mode` / `save_hack_mode`, and `resolve_hack_mode(search)` using the existing
  `resolve_on_escape(search, 'hack', persisted)` shape (`engine_flags_pref.js:110-116` — a
  default-off opt-in, URL `?hack=1` wins; `?hack=0` explicitly forces off for QA A/B).
- **Bridge**: `engine_flags.js` gains `set_hack_mode(enabled)` via the existing
  `apply_wireable_flag` (persist → live session reboot → fight-block revert+toast). Note the one
  divergence from the sun_follow trio: no `__ARES_*` global — `create_session` reads
  `resolve_hack_mode(location.search)` directly and passes the `presentation` option.
- **Settings row** (`pages/settings.tsx` render-options panel, after the taau row): standard
  `ToggleRow`, optimistic-update-then-revert like `on_sun_follow` (`settings.tsx:175-178`).
  Copy leads with the pro-player purpose, perf second:
  - `world.hack_mode_label` — EN: `Hack mode`
  - `world.hack_mode_hint` — EN: `Replaces the terrain with a flat retrowave grid — pure x,z
readability for pro play, and a much lighter GPU load. Fights, gathering and positions are
identical; only the scenery changes. Applies live (blocked during a fight).`
- **i18n ×6**: `de.json en.json es.json fr.json ja.json uk.json` — both keys, same commit as the
  row (constitution).

---

## 7. Drift-proof matrix

**Generic — consumes the oracle/composition, ZERO change** (the proof the seam holds):

| Consumer                                                   | Anchor                                                                                               |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| character controller collision                             | `engine/src/player/character_controller.js` via the session sampler closure `embed_voxel.js:352-362` |
| physics/input gate                                         | `game/spawn_column_gate.js:21-26`, `embed_voxel.js:661-700`                                          |
| boot veil readiness                                        | `game/embed_voxel_boot.js:52-81`                                                                     |
| entombment guard / under-map rescue / floor net            | `embed_voxel.js:456-513, 701-747` (can no longer fire; still correct)                                |
| mob/gather/NPC grounding                                   | `game/spawn_rigs.js:91,181,212`, `game/world_spawns.js`                                              |
| nearby-fights herald grounding                             | `game/world_fights_discovery.js:81`                                                                  |
| remote rig grounding                                       | `game/remote_players.js:421`                                                                         |
| local player retarget/teleport Y                           | `game/embed_voxel_player.js:325-330`, `embed_voxel.js:432-437`                                       |
| world-fight board seating (p90 of a flat footprint = flat) | `embed_voxel.js:838-859`, `world-shell/voxel_fight_folds.js:90-95`                                   |
| cave/dungeon presentation + sampler swap                   | `game/cave_session.js` via `embed_voxel.js:354-356, 572-589`                                         |
| zone/group/gather derivation (x,z pure)                    | `packages/sim/src/zone_derive.js`                                                                    |
| region music / biome probes (real-world truth kept)        | `engine.js:73-79` re-exports; `set_gen_config` still runs (`engine.js:361`)                          |
| chat online count (mode-blind)                             | `game/core/presence_count.js:7` + `presence_count_ssot.test.js`                                      |
| checkpoint/session position restore (x,z; Y re-derived)    | `embed_voxel.js:364-399`                                                                             |

**Needs-seam — the exhaustive edit list** (anything beyond this list in review = drift):

| Edit                                                                                                                           | File(s)                                                                                                   |
| ------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| `presentation` option, hack construction branch, oracle overrides, boot signals, `arm_border` const, `hack_presentation?.tick` | `packages/engine/src/engine.js` (`:300-322` options, `:817` fork, `:1392-1414` oracle, `:542-570` border) |
| `atmosphere: false` renderer option (forces existing analytic/no-atmo rungs)                                                   | `packages/engine/src/core/renderer.js` (`:702-731`)                                                       |
| grid plane + retrowave sky + presentation oracle (NEW)                                                                         | `packages/engine/src/render/hack_grid.js` (+ test)                                                        |
| demo passthrough `?hack=1` (slice-A proof rig)                                                                                 | `packages/engine/demo/main.js`                                                                            |
| mode resolve + `presentation` arg + `world_props` skip                                                                         | `packages/frontend/src/game/embed_voxel.js` (`:174-202`, `:555`)                                          |
| pref keys + resolver                                                                                                           | `game/screens/hud/world/engine_flags_pref.js`                                                             |
| `set_hack_mode` bridge                                                                                                         | `game/screens/hud/world/engine_flags.js`                                                                  |
| settings row                                                                                                                   | `packages/frontend/src/pages/settings.tsx`                                                                |
| i18n ×6                                                                                                                        | `packages/frontend/src/i18n/locales/*.json`                                                               |
| `hack` field in state broadcast                                                                                                | `packages/frontend/src/world-shell/party_store.js:541-551`                                                |
| `hack` whitelist in the peer fold                                                                                              | `packages/world/src/presence.js:173-196`                                                                  |
| hack axis on the render-instance predicate                                                                                     | `packages/frontend/src/game/remote_visibility_scope.js:22-28`                                             |
| scope read (mine/peer hack)                                                                                                    | `packages/frontend/src/game/remote_players.js:251-259`                                                    |
| e2e rail spec                                                                                                                  | `packages/frontend/e2e/hack_live_swap.spec.ts`                                                            |
| minimap lattice rendering — ADDED BY AMENDMENT A1 (§10), not in the original list                                              | `game/screens/hud/use_minimap.js`, `hud/MinimapModal.jsx`, `hud/minimap_engine.js`                        |

**Live-lane fences respected**: `packages/engine/src/tactical/*` + the entity-placeholder /
world character-resolver files (P0 lane) — consumed, never edited. `constants/navigation.ts`
(nav lane) — not touched (the settings route already exists). `world-shell/fight_*` (cutover
family) — not touched (`party_store.js` is outside that glob). No slice below needs to wait on a
live lane: the flat-height swap lives entirely in `engine.js`/`renderer.js`/`hack_grid.js`.

---

## 8. LANE PLAN (Opus slices, file-disjoint, ≤~90 min each)

Order: **A → B → (C ∥ D)**. B needs A's option name; C needs B's pref module; D needs A+B live.

### Slice A — engine hack presentation (the first visible toggle)

- **Files**: `packages/engine/src/render/hack_grid.js` (new, + `hack_grid.test.js`),
  `packages/engine/src/engine.js`, `packages/engine/src/core/renderer.js`,
  `packages/engine/demo/main.js`.
- **Build**: `presentation` option + hack branch per §1.2-§1.4; `hack_grid.js` exports
  `HACK_GROUND_Y`, `create_hack_presentation({ scene }) → { sky_node, sample_block,
is_column_resident, ground_at, tick, dispose }`; demo boots it under `?hack=1`.
- **Accept**: demo at `?hack=1` shows grid + retrowave sun, zero terrain; unit tests pin the
  oracle (`sample_block(0,137,0)` solid, `(0,138,0)` air, `is_column_resident` true, ground_at 137) and that `create_engine({presentation:'hackgrid'})` spawns **no** workers; default path
  byte-identical (no option ⇒ today's boot).
- **Prove**: `cd packages/engine && bun test src/render/hack_grid.test.js`,
  root `bun run lint` + `bun run typecheck`; one demo screenshot via the engine playwright rig.

### Slice B — the setting, arming, live apply, i18n

- **Files**: `engine_flags_pref.js` (+ its test), `engine_flags.js`, `settings.tsx`,
  `embed_voxel.js`, `i18n/locales/{de,en,es,fr,ja,uk}.json`.
- **Build**: §6 verbatim + §1.5 composition (`presentation` arg, spectate excluded,
  `world_props` skip).
- **Accept**: toggle OFF→ON live-reboots into the grid (no reload); `?hack=1` boots straight in
  with a saved OFF pref (URL precedence test); in-fight toggle reverts + toasts; all six locales
  carry both keys (the i18n parity tests stay green).
- **Prove**: `cd packages/frontend && bun test src/game/screens/hud/world/engine_flags_pref.test.js
src/i18n`, root `bun run lint` + `bun run typecheck`; a driven dev-server boot showing the
  toggle flip (console `get_active_world_config` + canvas screenshot).

### Slice C — mode-scoped visibility, universal presence

- **Files**: `packages/world/src/presence.js` (+ test), `world-shell/party_store.js`,
  `game/remote_visibility_scope.js` (+ test), `game/remote_players.js`,
  `presence_count_ssot.test.js` (extend).
- **Build**: §4 verbatim — one broadcast field, one fold line, one predicate axis, one scope
  read.
- **Accept**: predicate table test (hack×hack render, hack×terrain never, dungeon branch
  unchanged, absent-bit ⇒ terrain); fold test (bit whitelisted, liveness untouched); count test
  (cross-mode peer still counts). RED-FIRST: the cross-mode-ghost test lands red before the
  predicate change.
- **Prove**: `bun test packages/world packages/frontend/src/game/remote_visibility_scope.test.js`,
  root gates.

### Slice D — the QA rail (the contract, executable)

- **Files**: `packages/frontend/e2e/hack_live_swap.spec.ts` (own file only — no shared spec
  edits).
- **Build**: boot `/game-world?dev&hack=1` (the `session_position_restore.spec.ts` rig: DEV key,
  create-if-empty, `__voxel_ctl` probes); assert the §3 contract: instant readiness (veil gone,
  physics live under a hard small timeout), constant ground (`sample_block` probes at 3 spread
  columns), deterministic straight-line walk (hold W 2 s → x,z displacement within tolerance,
  y stays 138±ε), entities-on-plane (any visible spawn rig's y), `get_stats().resident_chunks
=== 0` + draw-call ceiling as the perf tooth.
- **Accept**: spec green headless against the dev server; documented at the top as "the QA
  contract of docs/design/hack_mode_spec.md §3 — drivers code against THIS".
- **Prove**: `cd packages/frontend && bunx playwright test e2e/hack_live_swap.spec.ts`.

Every slice: conventional commit, its files only, root `bun run test` / `lint` / `typecheck`
verbatim before handing back (CI-exact-invocation law). Attempt budget 2 per slice, then
`BLOCKED` + escalation brief.

---

## 9. Open questions

None. Decided in this spec from the repo + the briefs: plane Y (=138, §1.3), option name
(`presentation: 'hackgrid'`), pref/URL spelling (`aresrpg.hack_mode_enabled` / `?hack=1`),
default OFF, live-apply via session reboot (fight-blocked), spectate excluded, WebGL floor
ignores the option (warn), **the minimap renders the lattice, not the real map** (A1 — this line
originally said the opposite), dungeons keep the cave room, sun fixed north as a landmark,
broadcast field `hack` on the `state` payload with receiver-side filtering, presence untouched,
`world_props` skipped, mana barrier kept.

---

## 10. Amendments

A decision in this spec that ships differently is superseded HERE, dated, with the change that
did it — the section above keeps stating the current decision, and this section keeps the fact
that it changed. A spec whose §9 says "None" and whose code says otherwise is worse than one that
never claimed to be closed.

**A1 — the minimap renders the lattice (2026-07-25, `58a6cf36` / #818; recorded 2026-07-26 per
#843, #847).** This spec decided "the minimap keeps the real terrain map" in FIVE places — §1.2
(the rationale), §3 item 8 (the QA contract), §5 (the kept-cost list), §7 (the zero-change
matrix) and §9 (the summary). Shipped hack mode does the opposite, deliberately: the world under
a hack session IS a flat neon lattice, so a relief map of terrain nobody can see is both a lie
and a pointless terrain-probe pass. All five statements above now read the shipped behaviour.

Ground truth: both map surfaces branch on the same `resolve_hack_mode(location.search)` the world
reads — `use_minimap.js` (skips the colour-table warm and the resample entirely) and
`MinimapModal.jsx` (builds the slab, skips both progressive passes) — and both paint through
`minimap_engine.js`'s `hack_relief_grid` (a constant-height slab, zero `world_minimap_column`
probes) and `render_hack_grid_map` (an analytic lattice painter), whose palette and lattice pitch
come from the one shared home, `@aresrpg/engine3/hack` (`HACK_PALETTE` / `HACK_LATTICE`).

The §3 site is the one that mattered most: a QA contract does not merely describe the past, it
licenses what a driver may assume. Nothing else in this spec changed. The §2.1 palette table is a
separate finding — it re-types hexes that `packages/engine/src/render/hack_palette.js` owns and
is already stale; it is tracked on #847, not amended here.
