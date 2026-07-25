# THE COMPLAINT LEDGER — every recurring player-reported regression gets an impossible-to-fail gate

Every recurring complaint gets an impossible-to-fail gate. This file is the STANDING MAP from each recurring
complaint to the named test that would go RED if the complaint
regressed. It is MECHANICALLY ENFORCED: `bun ares test ledger` (folded into the default `ares test` pipeline)
parses the table below and asserts every `GATED` row's test is DISCOVERABLE — the `File` exists AND literally
contains the `Gate test (grep)` string. A renamed/deleted gate turns the ledger RED. Add a complaint → add a
row; the row is a lie until its test exists.

**The gate's boundary — discoverability, not execution.** This map proves each `GATED` complaint has a named,
findable test; it does NOT prove that test EXECUTED (or passed) in any given run — a gate rotting inside a
skipped suite would stay green here. Execution honesty is the `ares` pipeline's job: for the fight family it is
enforced by the anchor leg's driven-fight JSON gate. The runner is the execution oracle; this file is the map.

Columns: **Complaint** (the recurring complaint) · **Gate test (grep)** (a verbatim substring of the test's
title/name) · **File** (repo-relative home) · **Status** (`GATED` = enforced here · `GAP` = no dedicated gate
yet; `File` holds the proposed home, `Gate test` the reason).

<!-- LEDGER-TABLE-START (parsed by test/gold/ledger_gate.mjs — keep the 4-column shape; · and / are fine, | is the delimiter) -->

| Complaint                                                                                                  | Gate test (grep)                                                                                                    | File                                                                      | Status |
| ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ------ |
| "my turn then I can't play" — turn never arms                                                              | MULTI-TURN CYCLE                                                                                                    | test/gold/specs_anchor/fight_lifecycle.spec.ts                            | GATED  |
| each spell cast re-arms a 3s end-turn timer (per-cast disease) (number home: SPEC §7b E11)                 | three casts inside the turn add ZERO gating                                                                         | packages/fight/test/turn_pacing.test.js                                   | GATED  |
| end turn is "paused for 3s then available" — the one per-turn floor (number home: SPEC §7b E11)            | the floor is 3s from turn start                                                                                     | packages/fight/test/turn_pacing.test.js                                   | GATED  |
| a sub-3s end-turn must hold to the floor, then commit (number home: SPEC §7b E11)                          | a sub-3s end-turn is HELD until the floor                                                                           | packages/fight/test/turn_pacing.test.js                                   | GATED  |
| mob pushed then "slide back then is pushed again" (poll re-lays board)                                     | convergence — dup poll                                                                                              | packages/fight/test/parity.test.js                                        | GATED  |
| pushed mob shows a phantom "+4 in purple" (bare displacement float)                                        | Cast + Displaced                                                                                                    | packages/fight/test/render_queue_matrix.test.js                           | GATED  |
| "mobs don't seem to attack me and their vfx do not play"                                                   | -mob wave paces at                                                                                                  | packages/fight/test/render_queue_matrix.test.js                           | GATED  |
| mob turn timing — 3s per mob, 6 mobs = 18s (number home: SPEC §7b E10)                                     | six mobs alone                                                                                                      | packages/fight/test/turn_pacing.test.js                                   | GATED  |
| "the floating numbers appears too late after the vfx, like at least 1s late"                               | PACING CONFORMANCE                                                                                                  | test/gold/specs_anchor/pacing_conformance.spec.ts                         | GATED  |
| "it teleported me on the target cell then rolled me back and then made me run on it"                       | no teleport-then-walk                                                                                               | test/gold/specs_anchor/pacing_conformance.spec.ts                         | GATED  |
| kill insta-despawn — "never an instant vanish": mob melts before its death presents                        | the mob must not vanish before its death presents                                                                   | packages/frontend/src/world-shell/despawn_pacing.test.js                  | GATED  |
| "vfx are appearing too late, fight feels laggy" — beat causal order                                        | IN-TURN BEATS                                                                                                       | test/gold/specs_anchor/in_turn_beats.spec.ts                              | GATED  |
| "turns are having a hard time to commit" (flush completes)                                                 | IN-TURN BEATS                                                                                                       | test/gold/specs_anchor/in_turn_beats.spec.ts                              | GATED  |
| invisibility "is not removed when I cast a direct attack"                                                  | my own damaging cast reveals me THIS frame                                                                          | packages/fight/test/invisibility.test.js                                  | GATED  |
| "my HP being updating, it's a fucking integer in a div" (stale)                                            | WORLD HUD HP                                                                                                        | test/gold/specs_anchor/world_hp_live.spec.ts                              | GATED  |
| "try all our effects" — every spell-effect kind executes                                                   | COVERAGE — every K_* effect discriminant                                                                            | packages/sim/test/effect_kind_matrix.test.js                              | GATED  |
| every render beat fires from its queue event (renderer × queues)                                           | COVERAGE — every render beat kind                                                                                   | packages/fight/test/render_queue_matrix.test.js                           | GATED  |
| the deterministic adaptive fight, recorded and verified end-to-end                                         | ADAPTIVE FIGHT RECORD                                                                                               | test/gold/specs_anchor/fight_record_verify.spec.ts                        | GATED  |
| "the item I bought don't render in the inventory" (icons)                                                  | ICON RENDER                                                                                                         | test/gold/specs_anchor/regressions.spec.ts                                | GATED  |
| "shop images" 404 / broken (34/37 icons class)                                                             | evaluate_census — 34/37-broken-icons class                                                                          | scripts/prod_asset_census.test.mjs                                        | GATED  |
| "cosmetic color like sapphire" render to identical bytes (Ruby=Amber)                                      | evaluate_census — Ruby=Amber same-sha class                                                                         | scripts/prod_asset_census.test.mjs                                        | GATED  |
| "This item isn't a loot box" — lootbox won't open                                                          | optimistic inventory double-click opens                                                                             | test/gold/specs_anchor/lootbox_open.spec.ts                               | GATED  |
| "world picker lost the world levels, join them all at lvl 1"                                               | WORLD GATE                                                                                                          | test/gold/specs_anchor/world_gate.spec.ts                                 | GATED  |
| "traveling to a world wasn't fixed, still the world I was in"                                              | worlds render live level gates and eligible travel commits                                                          | test/gold/specs_anchor/world_gate.spec.ts                                 | GATED  |
| going "too fast too far will be blocked" (travel speed gate)                                               | CHECKPOINT / SPEED GATE                                                                                             | test/gold/specs_anchor/regressions.spec.ts                                | GATED  |
| "the toast is still full width" (mobile toast wraps)                                                       | in-game toast wraps long text                                                                                       | test/gold/specs/mobile_fight_hud.spec.ts                                  | GATED  |
| "those white boarders on iphone" (canvas resize)                                                           | iPhone WebKit canvas follows the live visual viewport                                                               | test/gold/specs/mobile_viewport.spec.ts                                   | GATED  |
| fight-end/result card must stay clickable (Continue reachable)                                             | fight-end card keeps CONTINUE reachable                                                                             | test/gold/specs/mobile_fight_hud.spec.ts                                  | GATED  |
| mobile bottom nav clips — Settings/airdrop/kolizeum unreachable                                            | mobile companion shell keeps all nav pages reachable                                                                | test/gold/specs/mobile_app_shell.spec.ts                                  | GATED  |
| mobile profile mastery page belongs to a removed system                                                    | omits dead profile destination                                                                                      | test/gold/specs/mobile_app_shell.spec.ts                                  | GATED  |
| "bought cosmetics render correctly when worn"                                                              | WORN COSMETICS                                                                                                      | test/gold/specs_anchor/worn_cosmetics.spec.ts                             | GATED  |
| "tried to equip my just bought item, got an error toast"                                                   | DRAG EQUIP                                                                                                          | test/gold/specs_anchor/regressions.spec.ts                                | GATED  |
| level-up must not be a silent stat bump (XP freshness)                                                     | XP FRESHNESS                                                                                                        | test/gold/specs_anchor/xp_freshness.spec.ts                               | GATED  |
| "we should have batching for regular requests" (no limit spam)                                             | REQUEST DIET                                                                                                        | test/gold/specs_anchor/regressions.spec.ts                                | GATED  |
| "i never ever want to see any V2 on chain" (CLI name gate)                                                 | clean-name gate                                                                                                     | scripts/check-constraints.sh                                              | GATED  |
| multi-character group play (up to 6, same-wallet isolation)                                                | MULTI-CHARACTER FIXTURE                                                                                             | test/gold/specs_anchor/regressions.spec.ts                                | GATED  |
| "listed items should not show in the inventory" (listing reconcile)                                        | own optimistic LIST holds                                                                                           | packages/frontend/src/stores/marketplace_chain.test.ts                    | GATED  |
| "buying something in the shop should trigger the modal to ask for quantity, it only does it for lootboxes" | every purchasable category opens the quantity modal                                                                 | packages/frontend/src/pages/shop_buy_plan.test.js                         | GATED  |
| routes must not mount until item art resolves (icon boot)                                                  | IMAGE MANIFEST BOOT                                                                                                 | test/gold/specs/asset_manifest_boot.spec.ts                               | GATED  |
| WebGPU console floods every frame — scene depth is sampled while its pass writes the same attachment       | WEBGPU DEPTH FLOOD — the post-stack warm renders once                                                               | packages/engine/src/core/streaming_pipeline_prewarm.test.js               | GATED  |
| "I still can't crush item" — crush/salvage click is dead                                                   | a crushable item dispatches the crush action exactly once                                                           | packages/frontend/src/components/crush_menu.test.tsx                      | GATED  |
| "show the version in small top right" — a testable version gate                                            | no version_badge unit test; version_badge.tsx ships untested                                                        | packages/frontend/src/version_badge.test.tsx                              | GAP    |
| "history shows I sold an item ... sold for 0 sui" (phantom sale)                                           | no dedicated history-projection regression; nearest is marketplace_chain sale-reconcile                             | packages/frontend/src/stores/marketplace_history.test.ts                  | GAP    |
| "I should not see my equipped gear/cosmetic/pet in the marketplace sell tab"                               | SELLFILTER store logic exists but no titled sell-tab filter gate                                                    | packages/frontend/src/chain/sell_filter.test.js                           | GAP    |
| "delete characters ... provided everything was unequipped first"                                           | no discoverable roster-delete gate                                                                                  | packages/frontend/src/roster/character_delete.test.js                     | GAP    |
| "2 different columns for general category ... and item_type" (browse) + search padding                     | pure CSS/layout, no gate                                                                                            | packages/frontend/src/components/marketplace/browse_layout.test.tsx       | GAP    |
| bots doing PvP and PvE co-op interleaved rows                                                              | PvE-coop row LANDED (coop_fight.spec.ts — joins, alternating turns, split settlement); PvP versus row still missing | test/gold/specs_multiplayer/coop_fight.spec.ts + versus.spec.ts (PvP GAP) | GAP    |

<!-- LEDGER-TABLE-END -->

**Pacing numbers have ONE home** (2026-07-17): SPEC §7b's envelope table + its executable twin
`test/gold/specs_anchor/pacing_envelopes.ts` — the `(number home: SPEC §7b E…)` pointers above. Ledger rows gate
the MECHANISM (the tests named here); the §7b table owns the VALUES, and a retune lands there, never in a test.

## Gaps (named, with reason) — the honest remainder

Seven complaint classes have **no dedicated impossible-to-fail gate yet**. Each is named above with a proposed
home so the next lane wires it red-first:

1. **Version badge unit test** — `version_badge.tsx` ships and the string is visible in-app, but there is no
   discoverable unit test pinning it. The e2e suites don't assert the badge text. Wire `version_badge.test.tsx`.
2. **Phantom sale in history** — "sold for 0 SUI" on what was actually an equip. The marketplace store's
   sale-reconcile (`marketplace_chain.test.ts`) covers listing holds, but no test pins the HISTORY projection
   rejecting a non-sale. Wire `marketplace_history.test.ts`.
3. **Equipped items hidden from the sell tab** — the filter logic exists; no titled gate asserts an equipped
   cosmetic/pet is excluded from the sellable set. Wire `sell_filter.test.js`.
4. **Character delete (unequip-gated)** — no gate proves an all-unequipped character deletes and an equipped
   one is refused. Wire `character_delete.test.js`.
5. **Browse two-column + search padding** — pure layout complaints; a mobile/marketplace layout assertion is
   proposed (`browse_layout.test.tsx`).
6. **Encyclopedia content duplicates** (2 ruby/2 sapphire) — the byte-level Ruby=Amber sha gate catches
   identical renders; a _content_ dedup census (distinct template ids per family) is not yet a gate.
7. **Interleaved PvP / PvE-coop rows** — the orchestrator's actor registry + SDK verbs exist, but the
   two-actor PvP-settle and party-coop-alternating-turns rows are still unbuilt (ORCH report items 2–3). Wire
   `test/gold/specs_multiplayer/versus.spec.ts`.

Deliverable claim (2026-07-16): **34 of 41 complaint classes are GATED (83%); 7 gaps named above with reasons
and proposed homes.** The gated set is asserted-discoverable by `bun ares test ledger`.
Delta (2026-07-17, §7b pacing wave): +3 GATED rows (late floater · teleport-then-walk · kill insta-despawn) —
**37 GATED / 44 classes**.
Delta (2026-07-18, shop quantity-modal directive): +1 GATED row (the corpus-enumerating universal-acquire gate,
`shop_buy_plan.test.js`) — **38 GATED / 45 classes**.
Delta (2026-07-18, WebGPU depth-flood fix): +1 GATED row (the focus-ready warm may render once but never leave
`PassNode.compileAsync` state live across frames) — **40 GATED / 46 classes**.
Delta (2026-07-18, crush action dead fix): +1 GATED row (crushable dispatch + explained disabled state) —
**41 GATED / 47 classes**.
