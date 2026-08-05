# Reuse registry

Facts in this registry are consumed by import or derivation only, and this table is the MANIFEST the gate reads — there is no second file listing what is protected. `scripts/dual-home-gate.sh` re-derives each protected symbol from the `path:line` anchors below and generates the fence at check time (issue #2222); the sim-constants ratchet (`scripts/arch/sim_protocol_constants.yml`) keeps enforcing the protocol-constants family by value alongside it. Four things red:

- **a second declaration** of a registry symbol, exported or laundered into a local (`registry-fact`);
- **a second importable surface** — any module but the home re-exporting the fact, including under an alias, which is how a fact starts travelling under a name this table never named (`registry-surface`);
- **a consumer binding the fact** from a specifier that does not resolve to its home (`registry-importer`);
- **a rotten anchor** — a row whose `path:line` declares nothing, so every rule derived from it silently stopped (`registry-anchor`).

Each anchor must therefore point at the DECLARATION line of its fact. The fence a row generates follows from its anchor and nothing else: an anchor in an importable JS/TS module gets the import rules above, while an anchor in a Move source (chain law, consumed across the twin by value rather than by import) generates none and is reported as unfenceable in the gate's fence report — the gate never claims coverage it does not have. A row naming a file that no longer exists throws: registry staleness is never a silent skip.

| Fact domain                             | Canonical home                                                                                                                      |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Forgemagie stat/rune catalog            | `packages/move/foundation/sources/rune_catalog.move:118`, `:123`, `:130` — the values consumed by chain execution.                  |
| Spell-effect kind IDs and display names | `packages/sim/src/spell_effect.js:11` — parity-derived mechanics vocabulary exported to JS consumers.                               |
| Character XP curve and maximum level    | `packages/move/foundation/sources/character_xp.move:12`, `:18` — chain progression law.                                             |
| `ItemStatistics` field shape and order  | `packages/move/aresrpg/sources/item_stats.move:37` — stored chain struct layout.                                                    |
| Status effect/flag protocol constants   | `packages/sim/src/spell_effect.js:20`, `:22`, `:38`, `:112` — exported effect protocol constants.                                   |
| Job XP curve and maximum level          | `packages/move/foundation/sources/job_xp.move:12`, `:16` — chain job progression law.                                               |
| Numeric stat IDs                        | `packages/sim/src/spell_effect.js:93` — exported mechanics protocol.                                                                |
| Crush-yield formula                     | `packages/move/foundation/sources/forgemagie.move:329` — formula that mints the actual runes.                                       |
| Crush level bands and divisors          | `packages/move/foundation/sources/forgemagie.move:304` — chain yield input.                                                         |
| Taux scale and bounds                   | `packages/move/foundation/sources/taux.move:54` — chain coefficient bounds.                                                         |
| AoE shape IDs                           | `packages/sim/src/spell_effect.js:58` — exported mechanics vocabulary.                                                              |
| Element ordinals                        | `packages/sim/src/spell_templates.js:189` — chain-normalization home.                                                               |
| AP/MP point-kind IDs                    | `packages/sim/src/spell_effect.js:90` — exported effect protocol.                                                                   |
| Target-filter bits                      | `packages/sim/src/spell_effect.js:83` — exported target protocol.                                                                   |
| Signed chain effect/status value codec  | `packages/sim/src/spell_templates.js:325` plus `packages/sim/src/spell_effect.js:20` — closest chain-effect decoder and kind owner. |
| Unlimited cast-cap sentinel             | `packages/sim/src/spell_templates.js:625` — spell-level normalization owner.                                                        |
| First-party extension namespace IDs     | `packages/move/aresrpg/sources/extension.move:24`, `:25`, `:26`, `:27` — actual dynamic-field namespace owner.                      |
| Centered item-stat bias                 | `packages/move/aresrpg/sources/item_stats.move:22` — stored-value encoding.                                                         |
| Characteristic points per level         | `packages/sdk/src/progression.js:17`, `:28` — reusable helper explicitly derived from chain progression.                            |
| Maximum-HP formula                      | `packages/move/foundation/sources/progression_math.move:20` — chain HP law.                                                         |
| Natural-regeneration formula            | `packages/move/foundation/sources/progression_math.move:27`, `:76` — chain HP mutation.                                             |
| Previsional roster HP marker            | `packages/inventory/src/fight_receipt_roster.js:19` — the only producer of `hp_previsional_ms`; `hp_updated_ms` stays chain-only.   |
| Combat-feeding item-stat fields         | `packages/sim/src/equipment_stats.js:29` — executable combat fold mapping.                                                          |
| Job wire-index order                    | `packages/sdk/src/jobs.js:39` — exported authored job catalog closest to job data.                                                  |
| Item category to equipment-slot kind    | `packages/move/aresrpg/sources/equipment.move:270` — equip gate used on chain.                                                      |
| Stackable item categories               | `packages/move/aresrpg/sources/item.move:51`, `:52`, `:53` — chain merge/split vocabulary.                                          |
| Ring/relic physical-slot capacities     | `packages/move/aresrpg/sources/equipment.move:104` — on-chain slot bookkeeping.                                                     |
| Projected dungeon/fight-view lifecycle  | `packages/fight/src/board_state.js:24` — projection owner.                                                                          |
| Stored chain fight status               | `packages/move/engine/sources/fight.move:19` — stored chain status.                                                                 |
| Mob fighter-ID base                     | `packages/move/engine/sources/retro_effects.move:465` — existing reusable chain decoder closest to the effect board.                |
| Minimum turn duration                   | `packages/move/engine/sources/actions.move:33` — enforced chain guard.                                                              |
| Default turn duration                   | `packages/move/aresrpg/sources/config.move:100` — default chain config.                                                             |
| `buy_many` item limit                   | `packages/move/aresrpg/sources/shop.move:63`, `:382` — enforced limit plus public getter.                                           |
| Active Sui network                      | `packages/frontend/src/chain/deployment.ts:6`, `:26` — chain client/deployment selector.                                            |
| Explorer transaction network            | `packages/frontend/src/chain/deployment.ts:26` — selected network.                                                                  |
| MIST per SUI                            | `packages/frontend/src/utils/sui_mist.ts:16` — dedicated conversion utility.                                                        |
| SUI transfer PTB shapes (send + drain)  | `packages/sdk/src/sui/write/sui_transfer.js:40` — the one composer both the dry-run and the signature use.                          |
| Shop equipment-category taxonomy        | `packages/frontend/src/constants/item_categories.ts:3` — exported UI taxonomy.                                                      |
| Client item-category vocabulary         | `packages/sdk/src/items.js:6` — exported client item-domain owner.                                                                  |
| Presence appearance revision            | `packages/frontend/src/world-shell/presence_appearance.js:50` — the one producer of the peer cache-invalidation signal (#2171).     |
| Browser WebGL-capability probe          | `packages/frontend/src/core/gl_support.js:26` — the one answer to "can this browser draw 3D at all" (#2235).                        |
