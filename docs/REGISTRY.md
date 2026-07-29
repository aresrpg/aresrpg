# Reuse registry

Facts in this registry are consumed by import or derivation only. Re-declaring a registry fact outside its canonical home is a gate violation; the existing sim-constants ratchet already enforces this for the protocol-constants family from scripts/arch/sim_protocol_constants.yml.

| Fact domain                             | Canonical home                                                                                                                     |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Forgemagie stat/rune catalog            | `packages/move/foundation/sources/rune_catalog.move:117`, `:123`, `:130` — the values consumed by chain execution.                 |
| Spell-effect kind IDs and display names | `packages/sim/src/spell_effect.js:11` — parity-derived mechanics vocabulary exported to JS consumers.                              |
| Character XP curve and maximum level    | `packages/move/foundation/sources/character_xp.move:12`, `:18` — chain progression law.                                            |
| `ItemStatistics` field shape and order  | `packages/move/aresrpg/sources/item_stats.move:35` — stored chain struct layout.                                                   |
| Status effect/flag protocol constants   | `packages/sim/src/spell_effect.js:20`, `:22`, `:38`, `:105` — exported effect protocol constants.                                  |
| Job XP curve and maximum level          | `packages/move/foundation/sources/job_xp.move:12`, `:16` — chain job progression law.                                              |
| Numeric stat IDs                        | `packages/sim/src/spell_effect.js:86` — exported mechanics protocol.                                                               |
| Crush-yield formula                     | `packages/move/foundation/sources/forgemagie.move:329` — formula that mints the actual runes.                                      |
| Crush level bands and divisors          | `packages/move/foundation/sources/forgemagie.move:304` — chain yield input.                                                        |
| Taux scale and bounds                   | `packages/move/foundation/sources/taux.move:54` — chain coefficient bounds.                                                        |
| AoE shape IDs                           | `packages/sim/src/spell_effect.js:57` — exported mechanics vocabulary.                                                             |
| Element ordinals                        | `packages/sim/src/spell_templates.js:194` — chain-normalization home.                                                              |
| AP/MP point-kind IDs                    | `packages/sim/src/spell_effect.js:83` — exported effect protocol.                                                                  |
| Target-filter bits                      | `packages/sim/src/spell_effect.js:76` — exported target protocol.                                                                  |
| Signed chain effect/status value codec  | `packages/sim/src/spell_templates.js:71` plus `packages/sim/src/spell_effect.js:20` — closest chain-effect decoder and kind owner. |
| Unlimited cast-cap sentinel             | `packages/sim/src/spell_templates.js:156` — exported spell-template semantic.                                                      |
| First-party extension namespace IDs     | `packages/move/aresrpg/sources/extension.move:23` — actual dynamic-field namespace owner.                                          |
| Centered item-stat bias                 | `packages/move/aresrpg/sources/item_stats.move:22` — stored-value encoding.                                                        |
| Characteristic points per level         | `packages/sdk/src/progression.js:17`, `:28` — reusable helper explicitly derived from chain progression.                           |
| Maximum-HP formula                      | `packages/move/foundation/sources/progression_math.move:20`, `:56` — chain HP law.                                                 |
| Natural-regeneration formula            | `packages/move/foundation/sources/progression_math.move:27`, `:72` — chain HP mutation.                                            |
| Combat-feeding item-stat fields         | `packages/sim/src/equipment_stats.js:29` — executable combat fold mapping.                                                         |
| Job wire-index order                    | `packages/sdk/src/jobs.js:39` — exported authored job catalog closest to job data.                                                 |
| Item category to equipment-slot kind    | `packages/move/aresrpg/sources/equipment.move:271` — equip gate used on chain.                                                     |
| Stackable item categories               | `packages/move/aresrpg/sources/item.move:357` — chain merge/split rule.                                                            |
| Ring/relic physical-slot capacities     | `packages/move/aresrpg/sources/equipment.move:71` — on-chain capacity.                                                             |
| Projected dungeon/fight-view lifecycle  | `packages/fight/src/board_state.js:20` — projection owner.                                                                         |
| Stored chain fight status               | `packages/move/engine/sources/fight.move:19` — stored chain status.                                                                |
| Mob fighter-ID base                     | `packages/move/engine/sources/retro_effects.move:418` — existing reusable chain accessor closest to the effect board.              |
| Minimum turn duration                   | `packages/move/engine/sources/actions.move:33` — enforced chain guard.                                                             |
| Default turn duration                   | `packages/move/aresrpg/sources/config.move:95` — default chain config.                                                             |
| `buy_many` item limit                   | `packages/move/aresrpg/sources/shop.move:63`, `:378` — enforced limit plus public getter.                                          |
| Active Sui network                      | `packages/frontend/src/chain/deployment.ts:6`, `:26` — chain client/deployment selector.                                           |
| Explorer transaction network            | `packages/frontend/src/chain/deployment.ts:26` — selected network.                                                                 |
| MIST per SUI                            | `packages/frontend/src/utils/sui_mist.ts:16` — dedicated conversion utility.                                                       |
| Shop equipment-category taxonomy        | `packages/frontend/src/constants/item_categories.ts:3` — exported UI taxonomy.                                                     |
| Client item-category vocabulary         | `packages/sdk/src/items.js:6` — exported client item-domain owner.                                                                 |
