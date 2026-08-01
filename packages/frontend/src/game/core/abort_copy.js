// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// ABORT-CODE → PLAYER COPY (the no-jargon law: raw chain text NEVER reaches a player surface).
// One abort-code → i18n-key table PER MODULE; unknown module/code pairs fall back to a generic human line
// (the digest stays in the console for devs — run_tx already logs it). Grow the table as findings file in;
// the KEYS live in all 6 locales (i18n law).
import i18n from '../../i18n'
import { game_log } from '../../core/log.js'
import { structural_kind_copy } from './abort_copy_structural_kind.js'

// MoveAbort raw shape: `MoveAbort(MoveLocation { … name: Identifier("character") … }, 109) …`
const ABORT_RE = /Identifier\("(\w+)"\)[\s\S]*?\}\s*,\s*(\d+)\)/
// PRE-FLIGHT SIMULATION abort shape (the S-54 dry-run refusal reports it, NOT the executed Identifier(...) form):
// `SimulationError: MoveAbort abort code 101 in actions::begin_action` (a real captured example). Captures the abort
// CODE and the owning MODULE (the segment before the function). Also matches @mysten/sui 2.20.1's
// `formatMoveAbortMessage` shape — `abort code: 104, in '0x0000…::actions::act_move' (instruction 18)` — the raw
// string a self-pay wallet surfaces on an executed abort (colon after `code`, comma + a quoted `pkg::module::fn`),
// which the plain-space form above did not. Both the colon/comma and the quote are OPTIONAL so one regex serves
// the sim string, the package-qualified sim string, AND the new executed-string phrasing. Package-qualified.
const SIM_ABORT_RE = /abort code:?\s*(\d+)[,\s]+in\s+'?(?:0x[0-9a-fA-F]+::)?(\w+)::\w+/i

/** The Move module identifiers this decoder maps — the coverage gate (abort_copy.coverage.test.js) asserts every
 *  abort-capable, player-reachable Move source module is either here or in that gate's documented exclusion set. */
export const decoder_covered_modules = () => Object.keys(TABLE)

/** module → the abort codes the decoder maps. The coverage gate classifies at CODE granularity: a mapped
 * module with an UNMAPPED code is exactly how a renumbered door silently falls back to generic copy. */
export const decoder_covered_codes = () =>
  Object.fromEntries(
    Object.entries(TABLE).map(([module_name, codes]) => [
      module_name,
      new Set(Object.keys(codes).map(Number)),
    ]),
  )

/** @type {Record<string, Record<number, string>>} module → abort code → i18n key */
const TABLE = {
  character: {
    109: 'errors.free_already_claimed', // new_free: the account's one free character was already claimed
    // (the legacy 111 "first character can't be deleted" row is DEAD + now-lying copy: BACKLOG 18 shipped
    // deletion for EVERY character incl. the free one, and the live character module has no code 111.)
  },
  // BACKLOG 18 — the character DELETE door (`aresrpg::character_extract::delete_character`). The UI
  // pre-checks equipped items, so a live 101 is a stale-read race; 102/103 are honest "finish your
  // business first" walls (the confirm card can't see a just-seated fight). The framework kiosk walls
  // (wrong kiosk / foreign cap / listed) are already mapped in the `kiosk` arm below.
  character_extract: {
    101: 'errors.delete_items_equipped', // EItemsEquipped — an equipped item would be orphaned: unequip everything first
    102: 'errors.delete_unfinished_fight', // EUnfinishedBusiness — an unopened fight result sits on the character: open it first
    103: 'errors.delete_in_dungeon', // EInDungeon — the character is mid-dungeon-run: exit or abandon it first
  },
  // S-84 create-modal funnel (`aresrpg::creation` — the character mint gate). Every create-modal-reachable refusal
  // gets honest copy (an un-whitelisted class reads "This class is coming soon", NEVER a raw
  // abort). 106 EFreeCharacterClaimed reuses the character arm's free-claimed copy (one home). Left GENERIC with
  // reason — the BOOTSTRAP free-path gates 109 ENotZkLoginAddress / 110 ENotAppSponsored / 111 EFreeDisabled are
  // infra/config states, not player-actionable (the app is zkLogin + station-sponsored by construction, and the
  // modal routes free-vs-paid), so a stale-client trip degrades to the generic line (the digest stays in console).
  creation: {
    101: 'errors.name_taken', // ENameTaken — the (normalized) name is already claimed
    102: 'errors.name_invalid', // ENameInvalid — length outside 4..19 / whitespace / non-ASCII byte
    103: 'errors.class_coming_soon', // EUnknownClass — the class isn't whitelisted yet ("coming soon")
    104: 'errors.creation_paused', // EPaused — character creation is paused (an admin stop control)
    105: 'errors.creation_insufficient_payment', // EInsufficientPayment — paid path: wallet below the gate price
    106: 'errors.free_already_claimed', // EFreeCharacterClaimed — one free character per account (character-arm copy)
  },
  dungeon_cast: {
    114: 'errors.cast_illegal_target', // can_cast_at reject (range / LOS / occupancy) — D68
    115: 'errors.cast_no_ap', // not enough AP for the spell
    118: 'errors.spell_cooldown', // spell still on cooldown
  },
  // Combat-engine cast door (`aresrpg_fight::cast::act_cast`, ENGINE) — the LIVE [1-9] spell-cast action
  // (voxel_fight_adapter.js). Module identifier "cast" is DISTINCT from the retired "dungeon_cast" M1 lineage
  // above — no collision. 101/102/105 mirror dungeon_cast's already-mapped meanings (AP / illegal-target /
  // cooldown), so they reuse the SAME copy (one home, never a second key for one fact). 104 ENotClassSpell
  // reuses the spell_level-arm precedent (a foreign-class spell honestly reads "not learned" — it could never
  // have been learned in the first place). 103/106 are the per-turn / per-target cast caps (spell_bands
  // casts_per_turn/casts_per_target, SpellDetail.jsx's "casts per turn"/"casts per target" rows) — DungeonBoard.jsx
  // already pre-checks both client-side (greys the socket at the cap), so a live 103/106 is a stale-client race
  // backstop; honest, non-punitive limit copy (the cap resets next turn).
  cast: {
    101: 'errors.cast_no_ap', // EInsufficientAP — ap < the level's ap_cost
    102: 'errors.cast_illegal_target', // EIllegalCast — can_cast_at rejects (range / LOS / occupancy / line-launch)
    103: 'errors.cast_per_turn_limit', // ECastsPerTurn — already cast this spell casts_per_turn times this turn
    104: 'errors.spell_not_learned', // ENotClassSpell — the spell isn't this caster's class (same copy as spell_level/101)
    105: 'errors.spell_cooldown', // ESpellOnCooldown — this spell is still inside its cooldown window
    106: 'errors.cast_per_target_limit', // ECastsPerTarget — already hit this target casts_per_target times this turn
    // 107 ECellAlreadyTrapped — a live trap already anchors the target cell (1.29 no-stack). The client greys the
    // caster's OWN trap cells pre-flight (DungeonBoard castable + cast_range_set_dungeon trap_cells), so a live
    // 107 means an ENEMY's INVISIBLE trap sits there — the abort honestly reveals it (accepted leak, cast.move).
    107: 'errors.cast_cell_trapped',
    // 110 EUnhandledEffectKind — the spell level names an effect kind neither sink implements, so the door
    // refuses rather than charge AP for nothing (cast.move sink tails). Not player-actionable, but silence
    // would read as a dead button: the honest line says the cast did not happen and cost nothing.
    110: 'errors.cast_effect_unsupported',
  },
  // #55 spell LEVEL-UP gates — the aborts fire in aresrpg_foundation::spell_book::upgrade (the MoveLocation
  // names the module `spell_book`), reached through character_spells::character_upgrade_spell.
  spell_book: {
    203: 'errors.spell_not_learned', // upgrade: spell not learned (level 0)
    204: 'errors.spell_maxed', // upgrade: already at max level (6)
    205: 'errors.spell_no_points', // upgrade: insufficient unspent spell points (S8 cost = target_level − 1)
    206: 'errors.spell_char_level', // upgrade: character level below the target level's min_char_level (#57)
  },
  // S-46 spell LEVEL-UP gates — the DEPLOYED door is `aresrpg::spell_level::raise_spell_level` (the
  // MoveLocation names the module `spell_level`); codes mirror spell_level.move's error constants.
  spell_level: {
    101: 'errors.spell_not_learned', // ENotClassSpell — a foreign-class spell (its points could never be cast)
    102: 'errors.spell_maxed', // EAlreadyMaxLevel — already at the template's top level (6)
    103: 'errors.spell_char_level', // ECharLevelTooLow — character level below the TARGET level's min_char_level
    104: 'errors.spell_no_points', // ENoSpellPoints — fewer unspent points than the escalating S8 cost
  },
  // #31 out-of-fight consumable USE (`aresrpg::consume::use_many`) + its heal target (character_link::heal_hp).
  // Only the player-reachable races are mapped — the UI pre-checks both, so these fire on stale reads only;
  // the structural codes (ENotConsumable / EUnsupportedEffect / EZeroQuantity) keep the generic fallback.
  consume: {
    101: 'spells.char_busy', // ECharacterInFight — seated in a LIVE fight (S-12f dirty marker)
  },
  character_link: {
    105: 'inventory.already_full_hp', // EAlreadyFullHp — a heal at full HP is blocked when pointless (SPEC §10)
    // CHARACTERISTIC-POINT allocation — the raise-stat player door. `stat_allocation` merged into this module at
    // the republish restructure and its codes moved to the 130 block. 132 is the actionable wall; EBadStat/
    // EZeroPoints (130/131) are client-clamped defensive races → generic fallback.
    132: 'errors.stat_no_points', // ENoStatPoints — fewer unspent characteristic points than the requested allocation
  },
  // aresrpg_items::shop mint-on-sale (S-19a — the retired M1 aresrpg_shop lineage is gone; `shop` is now unique
  // to the items package, the legacy commerce modules being `template_sale` / `cosmetic_shop`). Codes mirror
  // shop.move's constants (ESalePaused..ESaleEnded); maps by module name with no collision.
  shop: {
    101: 'errors.sale_paused', // ESalePaused — the sale is paused
    102: 'errors.payment_below_price', // EInsufficientPayment — payment below price × quantity
    103: 'errors.wrong_item', // EWrongTemplate — the passed template is not this sale's item
    104: 'errors.invalid_quantity', // EInvalidQuantity — quantity 0 or above the per-buy cap (client-clamped)
    105: 'errors.sold_out', // ESoldOut — the batch would exceed the sale's supply cap
    106: 'errors.sale_not_started', // ESaleNotStarted — the sale's start time hasn't been reached
    107: 'errors.sale_ended', // ESaleEnded — the sale's end time has passed
  },
  // F4/F5 E2E pass — fight create/join refusals (create_world_fight / join_world_fight / the dungeon
  // next_fight+join_fight doors, all in dungeon_actions.js). The module identifier "fight" is shared by TWO
  // packages: the core game wrapper `aresrpg::fight` (106/107/111) and the generic combat engine
  // `aresrpg_fight::fight` (101/102/103/104/108) — their LIVE codes never collide today, so one flat arm covers
  // both. Code 112 is the engine's `EWrongBrand` and stays on the generic fallback: reaching it requires a
  // foreign witness type that no live caller constructs. Also left generic: `EBadStartCells`(105,
  // Move-commented "structurally impossible"),
  // `EGatedJoins`(109, only trips when the raw join door is pointed at a door-created fight — this game's UI
  // never does that) and `EBadTeam`(110, `join` hardcodes team 0; team 1 is a kolizeum/PvP concept — out of
  // this pass's scope).
  fight: {
    101: 'errors.fight_zero_hp', // EZeroHp — create/join: the seated character is at 0 HP (defeated) — heal first
    102: 'errors.fight_team_full', // ETeamFull — join: the side is already at the fight's seat bound
    103: 'errors.fight_already_started', // ENotPlacement — join: the fight left placement (started) before you joined
    104: 'errors.fight_wrong_party', // ENotParty — join: a private party fight and your claimed party doesn't match
    106: 'errors.fight_world_changed', // EWrongWorld — create: the ticket's world != the passed &World (stale client)
    107: 'errors.fight_world_changed', // EWrongTemplate — create: the ticket's template != the passed &MobTemplate — same "refresh & retry" copy as 106
    108: 'errors.fight_already_seated', // EAlreadySeated — join: this character already holds a seat in this exact fight (F-01)
    111: 'errors.fight_unclaimed_result', // ECharacterMarked — seat: an unopened FightResult sits on the character — open it first (F4, P1)
  },
  // The two sharded fight books, both DIFFERENT modules than `fight` — no collision risk. `fight_registry` is
  // scope-keyed (it parents what a create derives); `fight_latch` is CHARACTER-keyed and answers the one
  // question every create/join asks: is this character already fighting. Both families assert on chain that the
  // PTB took the shard its key maps to, so a client that picked wrong aborts on 104 rather than touching a
  // stranger's book — a stale bundle, not a player mistake, hence the plain refresh line.
  fight_registry: {
    104: 'errors.fight_wrong_shard', // EWrongShard — this registry is not the shard the fight's scope maps to
  },
  fight_latch: {
    103: 'errors.fight_character_busy', // ECharacterInFight — create/join: this character is seated in ANOTHER live fight — settle/leave it first
    104: 'errors.fight_wrong_shard', // EWrongShard — this latch is not the shard the character maps to (same fact, same copy)
  },
  // S-57 SETTLE→OPEN — the composed ONE-TX settlement door (`aresrpg_fight::settlement::settle_and_take`, ENGINE;
  // the MoveLocation module is `settlement`, colliding with nothing else mapped here). Only the two POSSESSION
  // asserts are player-surfaced — both defensive/stale-client (we only ever settle a fight our OWN seated character
  // fought, and only from a WON/FAILED read): 102 fires if the character has no seat in that fight, 103 if the
  // seat's outcome belongs to another wallet. 101 ENotTerminal (settle before the fight went terminal) is
  // unreachable from the client (settlement only runs against a terminal read) → left to the generic fallback.
  settlement: {
    102: 'errors.settle_no_seat', // ENoSuchSeat — no seat for this character in that fight (stale client)
    103: 'errors.settle_not_seat_owner', // ENotSeatOwner — that seat's outcome belongs to another wallet
  },
  // S-80 — the FIGHT-forfeit door (`aresrpg_fight::actions::abandon`, ENGINE). The module identifier "actions"
  // collides with nothing else mapped here: act_move/act_weapon/act_cast/act_pass share the same Move module.
  // 104 EIllegalMove IS player-reachable — a mid-fight-refresh 104: a board-geometry mismap in fight_view
  // painted an off-shape cell reachable, so the committed act_move had bfs cost > mp (actions.move:39). The ROOT is
  // fixed in fight_bridge (the client now reads the chain-stored shape_mask, not a fragile seed-twin); this arm is
  // the honest fallback if any stale-client move ever reaches it. 102/103 stay generic (ENotParticipant /
  // ENotYourCharacter — no live door reaches them). 108 ETurnTooFast (the
  // instant-pass bot guard: act_pass asserts the turn lasted >= MIN_TURN_MS/3s) also maps now — honest, non-
  // punitive "wait it out" copy. 107 EActorDead stays generic (no live door surfaces a mid-turn self-kill race).
  // #515 — 101 ENotActive IS player-reachable despite the client's own terminal-race guard (dungeon-turn.js's
  // flush_commit only fires begin_action when its LOCAL status read is still ACTIVE): the killing blow can land
  // on-chain a moment before the deadline auto-commit's begin_action gets simulated/executed, so the guard's
  // local read is stale for exactly that race window. Previously that residual race fell through to the generic
  // "tx failed" scare copy; now it reads honestly as "the fight is no longer active."
  actions: {
    101: 'errors.fight_not_active', // ENotActive — begin_action into a fight that already went terminal (deadline-flush terminal race)
    104: 'errors.fight_stale_board', // EIllegalMove — act_move onto an off-board/occupied/unreachable cell (stale board)
    105: 'errors.abandon_fight_over', // EFightOver — abandon: the fight is already terminal, nothing left to forfeit
    106: 'errors.abandon_already_dead', // EAlreadyDead — abandon: this seat is already dead (idempotence guard)
    108: 'errors.turn_too_fast', // ETurnTooFast — pass: the turn ended before MIN_TURN_MS (3s) elapsed (instant-pass bot guard)
  },
  // The engine TURN MACHINE (`aresrpg_fight::turns` — place / force_start / crank / act). One door surfaces to a
  // player: 101 ENotPlacement fires when `turns::place` (the placement READY) is pressed AFTER the fight already
  // left placement — the exact STALE-SCREEN race a passive client hits when a force_start advances the fight under a
  // still-open "position your team" screen (the poll now follows that edge live, so this is the honest fallback for
  // the residual race). The rest stay generic: 102/103/104 (ENotYourCharacter / ENotParticipant / EBadStartCell) are
  // client pre-checked placement races; 105/106/107 (ENotActive / ENotYourTurn / ENotYetExpired) are crank/turn
  // machinery the client auto-fires; 108 ESomeoneOverdue is consumed by the overdue-crank retry, never surfaced.
  turns: {
    101: 'errors.placement_over', // ENotPlacement — place/READY after the fight already started (stale placement screen)
  },
  // F5 (P2) — gather refusals via the [G] prompt (gather_actions.js → gathering::gather, terminal &Random).
  // 102 ENoCheckpoint is Move-commented "defensive — a joined character always has one" (never fires once 101's
  // gate passed) — folded into 101's copy rather than skipped: zero new key, no downside if it ever does fire.
  // 103/107 both mean "the resource/rare-link changed under you" (stale client vs a swap-removed/relinked
  // node) — one shared "refresh & retry" copy. 104/105 are the same family (no job name rides the abort code,
  // so the copy stays job-agnostic).
  gathering: {
    101: 'errors.gather_not_in_world', // ENotInWorld — the character's world field isn't this world — rejoin it
    102: 'errors.gather_not_in_world', // ENoCheckpoint — defensive (a joined character always has one) — same copy as 101
    103: 'errors.gather_stale_node', // ETemplateMismatch — the passed ItemTemplate isn't the one this node spawns
    104: 'errors.gather_no_tool', // EEquipmentUnavailable — no equipment map attached (no tool can register as equipped)
    105: 'errors.gather_no_tool', // ENoTool — the matching job tool isn't equipped — same family/copy as 104
    106: 'errors.gather_tier_locked', // ETierLocked — the character's job level is below this resource tier's unlock level
    107: 'errors.gather_stale_node', // ERareTemplateMismatch — golden-gather: the passed rare_template isn't the world-linked variant — same "stale, retry" copy as 103
  },
  // Crafting refusals (craft_actions.js → crafting::craft, single self-pay tx). Pre-flight exact-stack
  // selection makes the over/under-supply codes near-unreachable (the client picks stacks summing EXACTLY to
  // each ingredient's need), but a stale-bag race can still trip them, so every code gets honest copy. 101
  // EWrongOutput can't fire from our builder (we pass the recipe's own output template) — mapped for completeness.
  crafting: {
    101: 'errors.craft_wrong_output', // EWrongOutput — the passed output template isn't this recipe's output
    102: 'errors.craft_unknown_ingredient', // EUnknownIngredient — a consumed item's template isn't in the recipe
    103: 'errors.craft_oversupply', // EIngredientOverSupply — more units of an ingredient supplied than the recipe needs
    104: 'errors.craft_missing_ingredient', // EMissingIngredient — an ingredient is missing/short after all inputs burned
  },
  // D54b checkpoint arm — the anti-teleport TRAVEL-VERIFICATION code, now inside `world`. The `checkpoint`
  // leaf module merged into `world` at the republish restructure, so the abort's MoveLocation module is
  // "world" and its codes moved to a 120 block: merged-in codes get their own range, because `world` already
  // used 101/102 for EOutOfBounds/EBadEntryIndex and a shared value made module+code ambiguous — the travel
  // recovery below keys on exactly this pair. TEACH, DON'T REJECT (the module's own header):
  // 102 is the one players actually hit — moved farther than the elapsed time supports at the world's speed
  // budget (e.g. rode with a pet then unequipped it) — non-punitive, elapsed only grows so a wait+retry always
  // clears it. 101 is a clock-desync transient that should never fire on a healthy chain. `wait_seconds()` is
  // a PUBLIC PURE Move fn built for the UI to say "wait Ns", but no client path can reach it today: a Move
  // abort carries zero payload (module+code only — no x/z/time), no SDK export calls `wait_seconds` (grep-
  // confirmed), and the indexer projects only the character's last-anchored POSITION event, never the
  // Checkpoint DF's `time_ms`/`pet_equipped` — so no exact countdown can be computed client-side without new
  // SDK/RPC plumbing (out of this leaf's scope). Both codes stay the honest generic teach line.
  world: {
    120: 'errors.checkpoint_clock_desync', // ECheckpointFuture — the clock landed before the last checkpoint (transient desync — retry)
    121: 'errors.travel_too_far', // ETravelTooFar — moved farther than the elapsed time supports — wait a moment, then retry
  },
  // `claim_mob_group` (the [R] engage door's first call, inside create_world_fight). ESpawnNotFound/108 fires
  // for BOTH real cases behind ONE code: "the group's zone isn't the caller's CHECKPOINT zone" (the FIRST
  // df::exists assert — bytecode instruction 13, the out-of-standing-zone case a real trace hit) AND "the group is
  // gone from that zone" (the loop-exhausted abort). The abort code can't tell them apart, so the RENDERER does:
  // world_spawns' hunt-zone pre-check catches out-of-zone BEFORE any tx (its own "search this zone to hunt here"
  // toast — instruction 13 can't reach the chain once the client only arms [R] in the checkpoint zone), so a 108
  // that DOES reach the chain is the genuine RACE — the only on-chain group removal is a claim, so the group in
  // your zone was claimed between your poll and your press. The race copy is honest for exactly that residual.
  // 110 EBadGroupProof is the SIBLING TOCTOU: the supplied facts/index/proof no longer authenticate against the
  // searched-zone root — the zone changed under you between the search-time snapshot the client proved against and
  // the press (a re-search / re-roll). Same honest, non-punitive "find another pack" family, distinct copy ("the
  // zone changed") so the player knows to re-search rather than just re-try the same spot. Both dry-run-passable
  // races (the engage gate + the pre-sign liveness re-check shrink them; this is the residual's honest name).
  // Other zones gates (101/102/103/105) stay on the generic fallback (no exhaustive dump).
  zones: {
    108: 'errors.fight_group_claimed', // ESpawnNotFound — claim race: the group in your zone was just claimed by another
    110: 'errors.fight_zone_changed', // EBadGroupProof — stale proof vs the searched-zone root: the zone changed — find another
  },
  // Dungeon run flow (rider on the F4/F5 pass) — the live doors are activate / next_fight / join_fight /
  // settle_run (dungeon_actions.js via @aresrpg/sdk/dungeon). 102 ENoCheckpoint is defensive (a joined character
  // always has one) — folded into 101's copy, the gathering-arm pattern. 107/110 both mean "your run state went
  // stale under you" (roster template vs run-world mismatch) — one shared "refresh & retry" copy. Left generic
  // with reason: 105 EBadRoom (room-0 guard — the pass mints at room 1 and only advances), 106 EEmptyRoom +
  // 108 ERoomNotHomogeneous (authoring defects — the validation package gates room content, never a player
  // state).
  dungeon: {
    101: 'errors.dungeon_not_in_world', // ENotInWorld — activate: the character is not in this world — rejoin it first
    102: 'errors.dungeon_not_in_world', // ENoCheckpoint — defensive (a joined character always has one) — same copy as 101
    103: 'errors.dungeon_none', // ENoDungeon — activate: this world has no dungeon (no key template authored)
    104: 'errors.dungeon_wrong_key', // EWrongKey — activate: the burned item is not this world's dungeon key template
    107: 'errors.dungeon_stale_run', // EWrongTemplate — next_fight: the passed &MobTemplate is not the room's roster template (stale roster read)
    109: 'errors.dungeon_wrong_room', // EWrongRoom — join_fight: the joiner's own room differs from the creator's fight room (§9 same-room proof)
    110: 'errors.dungeon_stale_run', // EWrongWorld — settle_run: the passed &World is not the run's world — same "refresh & retry" copy as 107
  },
  // The RunPass security core (`aresrpg::run` — a DIFFERENT MoveLocation module than `dungeon`): the latch/settle
  // asserts the dungeon doors call, so its aborts surface with module "run". Only the two player-reachable ones
  // map; left generic with reason: 101 EWrongRoom (assert_at_room is test-only — no live caller), 102 ENotOwner
  // (the pass is soulbound and the UI always signs as its owner), 103 ENotSingleKeyUnit (the SDK's activate PTB
  // isolates exactly one key unit), 106 EWrongFight + 107 EWrongCharacter (the client binds outcome→run
  // directly — a mismatch is a client bug, not a player state).
  run: {
    104: 'errors.dungeon_fight_live', // EAlreadyLatched — next_fight/join while the pass is latched to a LIVE room fight (double-ENGAGE / stale resume)
    105: 'errors.dungeon_already_settled', // ENotInFight — settle_run on an unlatched pass (double-settle: two tabs / refresh mid-chain)
  },
  // KOLIZEUM LEVEL HONESTY pass — the War Table's create/join/exit/cancel doors
  // (kolizeum_actions.js; the only kolizeum.move doors this frontend calls — start/seat/settle/sweep are
  // NOT wired here). ELevelTooLow (103) is a bare Move abort code with no payload — it can't carry the
  // gate NUMBER, so this copy stays generic; the create/join PRE-CHECK (kolizeum.tsx) is what shows the
  // actual number inline BEFORE the tx ever fires. This arm is the honest fallback for the residual race
  // (an admin just re-dialed the gate / a stale client) the pre-check can't see. This also fixes the
  // ACTUAL bug: kolizeum.tsx's toast wiring passed a static `error:` string that always
  // won over the humanized message (use_toast.promise() — see kolizeum.tsx's `run()`), so this table was
  // previously dead code for this page; that static override is now removed too.
  kolizeum: {
    101: 'errors.kolizeum_bad_format', // EBadFormat — create: format not in {1,3,6}, or above a tightened team-size-bound dial
    102: 'errors.kolizeum_pledge_mismatch', // EPledgeMismatch — create/join: the built pledge coin doesn't match the lobby's exact stake
    103: 'errors.kolizeum_level_too_low', // ELevelTooLow — create/join: character level below the kolizeum level gate (§17.30) — THE headline fix
    104: 'errors.kolizeum_level_diff', // ELevelDiffTooHigh — join: level too far from the creator's for this lobby's max-diff dial (not client-precomputed — the RPC doesn't project creator_level/max_level_diff per lobby)
    105: 'errors.kolizeum_not_open', // ENotOpen — join/exit/cancel: the lobby left OPEN between your poll and your click (started/cancelled/filled race)
    106: 'errors.kolizeum_not_friend', // ENotFriend — join: a friends-only lobby and you're not in the creator's snapshot
    107: 'errors.kolizeum_already_joined', // EAlreadyJoined — join: this wallet or character already holds a seat here
    108: 'errors.kolizeum_side_full', // ESideFull — join: the auto-balanced side filled between your poll and your click
    110: 'errors.kolizeum_not_participant', // ENotParticipant — exit: the exit button has no membership guard (any open lobby you're viewing shows it)
    // Left GENERIC with reason: 109 ENotFriendListOwner (create_friends_only is never called — do_create always
    // builds a PUBLIC lobby); 111 ENotCreator (the cancel button is already client-gated to `k.creator === address`,
    // the same defended class as the `run` arm's ENotOwner); 112 ENotStarted / 113 EBadSide / 114 ENoWinners /
    // 115 ENotSweepable / 116 EWrongFight (start/seat/settle/sweep — none of which kolizeum_actions.js calls).
  },
  // GIFT escrow (aresrpg::gift — the escrow-recoverable item send). Codes mirror gift.move's constants. Every one
  // is a stale-client race (the UI gates claim to the recipient + recall to the sender off the polled inbox), so
  // the copy is honest + non-punitive. 103 EEmptyGift can't fire from our builder (the send CTA needs ≥1 pick).
  gift: {
    101: 'errors.gift_not_recipient', // ENotRecipient — claim by someone who isn't the gift's named recipient
    102: 'errors.gift_not_sender', // ENotSender — recall by someone who isn't the gift's sender
    103: 'errors.gift_empty', // EEmptyGift — send with an empty item list (client-gated, defensive)
    104: 'errors.gift_too_many_items', // ETooManyItems — over MAX_GIFT_ITEMS; claim/recall must walk the list back
  },
  // Inventory EQUIP + loot-box OPEN share the same typed kiosk-extraction seam. Map the declared module codes and
  // their reachable item/gifting/kiosk/version/config guards so known failures never collapse to generic copy.
  equipment: {
    103: 'errors.equip_not_equippable', // ENotEquippable — category has no equipment slot
    104: 'errors.equip_slot_occupied', // ESlotOccupied — the single slot is already occupied
    106: 'errors.equip_relic_duplicate', // ERelicDuplicate — that relic template is already equipped
    107: 'errors.equip_relic_slots_full', // ERelicSlotsFull — all six relic slots are occupied
    108: 'errors.equip_ring_slots_full', // ERingSlotsFull — both ring slots are occupied
    109: 'errors.equip_level_too_low', // ELevelTooLow — character level is below the template requirement
    110: 'errors.equip_template_mismatch', // ETemplateMismatch — the passed template differs from the item
    111: 'errors.equip_unknown_class', // EUnknownClass — character class is outside the canonical table
  },
  extract: {
    101: 'errors.item_state_mismatch', // EPledgeMismatch — extracted item and pledge no longer agree
    102: 'errors.item_same_stack', // ESameStack — merge target and source are the same object
  },
  item: {
    101: 'errors.item_state_mismatch', // EPledgeMismatch — minted item and lock pledge do not agree
    102: 'errors.equip_level_too_low', // ELevelTooLow — shared item usability level gate
    103: 'errors.item_not_personal_kiosk', // ENotPersonalKiosk — destination kiosk is not personal
    104: 'errors.item_not_stackable', // ENotStackable — unique gear cannot use stack operations
    105: 'errors.item_zero_quantity', // EZeroQuantity — a stack/split must contain at least one unit
    106: 'errors.item_template_mismatch', // ETemplateMismatch — stack templates differ
    107: 'errors.item_split_too_large', // ESplitTooLarge — split would leave no source remainder
  },
  // ITEM-STAT SCALING leaf (`aresrpg::item_stats` — THE pet-equip suspect, #88). Its only reachable production
  // cause is `equipment::equip` normalizing a pet's stats off a LEGACY (pre-cadence, unbounded) PetPowerKey —
  // the live `feed_pet` cadence can never itself produce an out-of-range value (EFullyFed gates feed 61; see
  // pet_tests.move's legacy_overscaled_pet_power_aborts_equip_* regressions). So it is PERMANENT, never a
  // transient race, until the chain-side migration ships — the copy never says "refresh and retry".
  item_stats: {
    101: 'errors.item_scale_failed', // EInvalidScale — legacy-encoded pet power exceeds the live 0-60 bound; equip refuses until the migration lands
  },
  // PET feed (`aresrpg::pet` — the feed_pet player door). Only the actionable feed refusals map; the structural/
  // defensive codes (ENotPet/EUseFeedPet/ETemplateMismatch/ETemplateHasNoStats/EInvalidFoodPower/ESameItem/
  // EWrongBurnAmount) are client pre-checked stale-read races → generic fallback.
  pet: {
    101: 'errors.pet_not_food', // EUnknownFood — the consumed item isn't a configured pet food
    104: 'errors.pet_already_fed', // EAlreadyFedToday — the pet already ate its one feed this UTC day
    105: 'errors.pet_fully_fed', // EFullyFed — the pet reached its 60-feed cap (fully grown)
  },
  loot_box: {
    101: 'errors.lootbox_no_table', // ENoTable — box template has no non-empty loot table
    102: 'errors.lootbox_zero_weight', // EZeroWeight — the table cannot select any row
    103: 'errors.lootbox_not_box', // ENotBox — template lacks the gacha-box effect
    104: 'errors.lootbox_table_invalid', // EEmptyTable — admin-authored table is empty
    105: 'errors.lootbox_table_invalid', // ELengthMismatch — table template/weight vectors differ
    106: 'errors.lootbox_claim_mismatch', // EClaimMismatch — claimed pet differs from the roll
  },
  gifting: {
    106: 'errors.lootbox_box_mismatch', // EConsumeTemplateMismatch — passed box template differs from the item
    107: 'errors.lootbox_stack_too_small', // EConsumeExceedsStack — requested burn exceeds the stack
    108: 'errors.lootbox_zero_quantity', // EZeroConsume — requested burn is zero
  },
  kiosk: {
    0: 'errors.item_wrong_kiosk', // ENotOwner — the presented cap does not authorize this kiosk
    4: 'errors.item_listed_for_sale', // EListedExclusively — item is exclusively listed with a PurchaseCap
    9: 'errors.item_listed_for_sale', // EItemIsListed — listed items cannot be mutably borrowed/taken
    11: 'errors.item_wrong_kiosk', // EItemNotFound — this kiosk does not hold the requested item
  },
  version: {
    101: 'errors.world_version_changed', // EWrongVersion — client/shared object lineage is stale
    102: 'errors.contracts_paused', // ENotEnabled — package is dark/paused
  },
  config: {
    101: 'errors.game_paused', // ENotEnabled — global gameplay switch is off
    104: 'errors.lootbox_brand_mismatch', // EWrongGiftingBrand — gifting package/config binding drift
  },
  // AIRDROP whitelist claim-mint (aresrpg::airdrop). Codes mirror airdrop.move's constants. ENotEligible/101 is
  // the headline surface (not on the whitelist, or already claimed — the claim removes the address); EWrongTemplate
  // /102 is a stale-client mismatch (the card always passes the drop's own template).
  airdrop: {
    101: 'errors.airdrop_not_eligible', // ENotEligible — not whitelisted (never was, or already claimed)
    102: 'errors.airdrop_wrong_template', // EWrongTemplate — the passed template isn't the one this drop mints
  },
  // PARTY membership (`aresrpg_social::party`). Character-keyed roster and ownership-proof refusals from the
  // one live party surface; each maps to actionable copy instead of leaking Move abort jargon.
  party: {
    201: 'errors.party_not_leader', // ENotLeader
    202: 'errors.party_already_member', // EAlreadyMember
    203: 'errors.party_already_invited', // EAlreadyInvited
    204: 'errors.party_full', // EPartyFull — MAX_MEMBERS is six characters
    205: 'errors.party_invite_not_found', // EInviteNotFound
    206: 'errors.party_not_member', // ENotMember
    207: 'errors.party_cannot_kick_leader', // ECannotKickLeader
    208: 'errors.party_leader_alone', // ELeaderAlone
    209: 'errors.party_wrong_kiosk_cap', // EWrongKioskCap
    210: 'errors.party_character_not_owned', // ECharacterNotInKiosk
    211: 'errors.party_character_not_owned', // ENotCurrentOwner
    212: 'errors.party_not_solo', // EPartyNotSolo
  },
}

/**
 * Parse a raw chain error into its MoveAbort { module, code }, or null when it isn't one. Handles BOTH shapes a
 * caller can hand us: (1) the #23 gRPC Core receipt's STRUCTURED error object —
 * `{ $kind:'MoveAbort', MoveAbort:{ abortCode, location:{ module } } }` (run_tx passes `effects.status.error`
 * straight through; parseGrpcExecutionError builds this, NOT a string) — read the module + code straight off it;
 * and (2) the legacy STRING form `MoveAbort(MoveLocation { … Identifier("mod") … }, code)` (our own re-throws /
 * any stringified receipt). Discrimination is always NUMERIC (module + code), never by the Move constant's NAME
 * (W3 root: a /ERoomAlreadyClaimed/i test could never match a live abort — the name isn't in the receipt).
 * The `package` (the abort's MoveLocation package id) rides along when the structured form carries it — the M1
 * base-abort scoping needs it to stay collision-free with the legacy lineage's same-named modules; it's left
 * `undefined` (not null, so `toEqual({module,code})` still holds) when absent — the legacy string form and any
 * structured error without a package location.
 * @param {unknown} raw @returns {{ module: string, code: number, package?: string } | null}
 */
export function parse_move_abort(raw) {
  // (1) gRPC Core structured object
  const r = /** @type {any} */ (raw)
  const structured = r && typeof r === 'object' ? (r.MoveAbort ?? (r.$kind === 'MoveAbort' ? r : null)) : null
  const mod = structured?.location?.module
  const code = structured?.abortCode
  const pkg = structured?.location?.package
  if (mod != null && code != null && Number.isFinite(Number(code)))
    return { module: String(mod), code: Number(code), package: pkg != null ? String(pkg) : undefined }
  // (1b) an Error carrying the raw chain error as its `.cause` (the one-home throw sites preserve the structured
  // MoveAbort there while the `.message` is already player copy — so classification (claim_race) still parses it).
  if (r && typeof r === 'object' && r.cause != null && r.cause !== r) {
    const via_cause = parse_move_abort(r.cause)
    if (via_cause) return via_cause
  }
  // (2) legacy string form (also digs the `.message` off an unrecognised error object)
  const m = String(r?.message ?? raw ?? '').match(ABORT_RE)
  if (m) return { module: m[1], code: Number(m[2]) }
  // (3) SIMULATION string form — the PRE-FLIGHT dry-run refusal reports "abort code N in [pkg::]module::function"
  // (never the executed Identifier(...) shape), so ABORT_RE misses it: without this, is_fight_over_abort could
  // never swallow a terminal-race 101 (the killing blow ended the fight; the deadline auto-commit's begin_action
  // then simulates 101) and the toast could never map it. Dig the WHOLE error blob (message + cause chain + JSON)
  // so the abort string is found wherever the node buried it.
  const sim = to_message_string(raw, true).match(SIM_ABORT_RE)
  return sim ? { module: sim[2], code: Number(sim[1]) } : null
}

// A PRE-FLIGHT dry-run REFUSAL (the S-54 simulate gate refused a would-fail tx BEFORE the wallet ever signed →
// ZERO gas, no digest) vs an EXECUTED failure (a digest exists, gas WAS burned). The node's pre-flight error is a
// `SimulationError`; an executed abort (waitForTransaction) never carries that class name. CONSERVATIVE by design:
// only the literal "SimulationError" marker flips it, so a gas-burned executed failure can NEVER be mislabeled
// "no gas spent" (the tx-retry-burn law's honesty half). Checks names + the whole message/cause blob.
/** @param {unknown} error @returns {boolean} */
export function is_preflight_refusal(error) {
  const e = /** @type {any} */ (error)
  if (e == null) return false
  const names = [e.name, e.constructor?.name, e.cause?.name, e.cause?.constructor?.name].filter(Boolean).join(' ')
  return /SimulationError/i.test(`${names} ${to_message_string(error, true)}`)
}

// EQUIP/UNEQUIP LOCAL-READ STALENESS family (issue #15 — "stale-version equipment"): the exact abort codes that
// mean "the item's ACTUAL on-chain template/state differs from what this client's stale /v1 read believed" —
// a specific OBJECT drifted under the player (another tab equipped it, a scribe re-rolled it, a stack merged),
// never a permanently-dead template — a retired template aborts ETemplateMismatch (110) at simulate, which is
// the CHAIN's own verdict and not refresh-fixable (#1467 deleted the client-side build-time pin). Every code here is
// honestly refresh-fixable: a fresh /v1 read (equip_state_refresh.js's reconcile_equip_state) resolves it before
// the next attempt. STRUCTURAL only (module+code, never message text), mirroring is_preflight_refusal/
// error_preflight_marked's own "never message text" law.
/** @param {unknown} error @returns {boolean} */
export function is_equip_state_refusal(error) {
  const abort = parse_move_abort(error)
  if (!abort) return false
  return (
    (abort.module === 'equipment' && abort.code === 110) || // ETemplateMismatch — passed template != the item's stamped one
    (abort.module === 'item' && (abort.code === 101 || abort.code === 106)) || // EPledgeMismatch / ETemplateMismatch
    (abort.module === 'extract' && abort.code === 101) // EPledgeMismatch — confirm_equip's item id != the pledge's
  )
}

// #1136 — THE FIGHT IS OVER, AND THE CHAIN JUST SAID SO. `aresrpg_fight::actions` refuses every act door on a
// fight that already went terminal: 101 ENotActive (begin_action into a resolved fight) and 105 EFightOver
// (abandon with nothing left to forfeit). Discriminator ① of the live defect was confirmed by machine —
// the Fight had been settled and DELETED underneath a live-looking board — so this abort is not a "your cast
// failed" error at all: it is the client's own proof that the session it is rendering no longer exists. Treating
// it as copy is what stranded the player on a dead board until stall. Consumers route it to the SAME terminal
// door the gone-object read takes; the copy layer above still names it honestly.
// STRUCTURAL only (module+code, never message text), exactly like is_equip_state_refusal above.
/** @param {unknown} error @returns {boolean} */
export function is_fight_over_abort(error) {
  const abort = parse_move_abort(error)
  return abort?.module === 'actions' && (abort.code === 101 || abort.code === 105)
}

// Chain jargon that must NEVER reach a player surface — any string carrying it degrades to the generic line.
const JARGON_RE =
  /MoveAbort|VMError|InsufficientGas|Identifier\(|MoveLocation|\$kind|CommandArgumentError|0x[0-9a-f]{6,}/i

// PRE-EXECUTION gas/balance refusal (NO digest — re-armable, NEVER latches): the node/GraphQL can't select a gas
// coin because the wallet lacks enough SUI for the required budget. Owner-hit raw shape (leaked unhumanized):
// "GraphQLResponseError: Invalid argument: Unable to perform gas selection due to insufficient SUI balance of
//  <have> to satisfy required budget <budget>". It carries NO MoveAbort (parse_move_abort → null) AND escapes
// JARGON_RE, so without this arm the raw blob reaches the surface — humanize it BEFORE the jargon gate.
const GAS_BALANCE_RE =
  /insufficient\s+sui\s+balance|gas selection|unable to perform gas|to satisfy (?:the )?required budget/i
const REQUIRED_BUDGET_MIST_RE = /required budget[^0-9]*(\d{5,})/i

// SUBMISSION-TIME LOCK / EQUIVOCATION RACE + sponsor GAS-COIN CONTENTION — every shape here carries ZERO
// on-chain effect (NO digest, NO gas): (1) a Sui object-version lock conflict at the client's own submit step —
// the gas coin (or a shared input) was consumed by a competing tx first, so THIS tx never certifies (a 2f+1 lock
// goes to the winner ONLY: no digest, nothing burned); and (2) the sponsor's own 'sponsor-busy' PRE-SIGN refusal
// (2026-07-14 equivocation fix — gas coins contended, it never even signed). CONSERVATIVE by construction
// (tx-retry-burn law): an EXECUTED failure is a MoveAbort — parse_move_abort handles it ABOVE and returns before
// this arm — so a gas-burned failure can never reach here and be mislabeled "nothing charged, retry". Every
// pattern is a consensus/submission-lock or pre-sign shape that CANNOT carry a digest. Matched BEFORE the jargon
// gate (a locked-object error quotes the object id → 0x… would otherwise trip JARGON_RE into the on-chain-failed line).
const LOCK_RACE_RE =
  /sponsor-busy|object.{0,40}(?:version|lock)|locked (?:by|for) another|not available for consumption|reserved for another transaction|quorum.{0,60}locked/i

/** Player copy for a pre-exec gas-selection / insufficient-balance error, or null when the text isn't one. When
 * the required budget (MIST) parses, quote the SUI the player must free; else the generic gas-balance line. */
function gas_balance_copy(/** @type {string} */ text) {
  if (!text || !GAS_BALANCE_RE.test(text)) return null
  const m = text.match(REQUIRED_BUDGET_MIST_RE)
  if (m) return i18n.t('errors.gas_insufficient_balance', { amount: (Number(m[1]) / 1e9).toFixed(3) })
  return i18n.t('errors.insufficient_balance') // generic gas-balance line (no parseable budget)
}

/** Pull the best clean message off a thrown shape. `technical` permits JSON only for internal classifiers. */
function to_message_string(/** @type {unknown} */ error, technical = false) {
  if (error == null) return ''
  if (typeof error === 'string') return error
  const e = /** @type {any} */ (error)
  // GraphQL / aggregate error arrays: { errors:[{message}] } or a bare [{message}]
  const arr = Array.isArray(e) ? e : Array.isArray(e.errors) ? e.errors : null
  if (arr?.length) {
    const first = arr.map((x) => x?.message ?? x).filter(Boolean)[0]
    if (first) return typeof first === 'string' ? first : to_message_string(first, technical)
  }
  if (typeof e.message === 'string' && e.message && e.message !== '[object Object]') return e.message
  if (e.cause != null && e.cause !== e) {
    const via = to_message_string(e.cause, technical)
    if (via) return via
  }
  // Raw object payloads are diagnostic DATA, never player copy. Internal abort/pre-flight classifiers still need
  // their full blob; toast-facing humanization falls through to its honest contextual generic instead.
  if (!technical) return ''
  try {
    const json = JSON.stringify(e)
    if (json && json !== '{}') return json.length > 200 ? `${json.slice(0, 200)}…` : json
  } catch {
    /* circular / non-serialisable — fall through */
  }
  return ''
}

/**
 * THE ONE HOME for turning ANY thrown transaction error into PLAYER copy (raw chain text — and above
 * all "[object Object]" — never reaches a surface). Handles every shape a tx path can throw: a structured/legacy-
 * string MoveAbort → its mapped i18n line, else (preflight only) a "Reason:" line naming module+code; a plain
 * Error/string (our own human throws) → untouched; a GraphQL/aggregate error array → its first message, jargon-
 * gated; a non-MoveAbort gRPC ExecutionError → its structural `$kind` copy; anything else → an honest generic.
 * @param {unknown} error @param {{ phase?: 'kiosk_lookup' }} [opts] @returns {string}
 */
export function humanize_tx_error(error, { phase } = {}) {
  // Enoki proof failures are decoded once at the auth seam into a structural marker. The raw SDK message
  // ("failed to get zkp") and its invalid-field response body stay diagnostic-only.
  if (/** @type {any} */ (error)?.code === 'zklogin_proof_unavailable')
    return i18n.t('errors.zklogin_proof_unavailable')
  // HONESTY SPLIT: "failed on-chain" LIES for a pre-flight refusal (ZERO gas spent) — a refusal says "no gas spent" while an EXECUTED failure keeps its own copy.
  const preflight = is_preflight_refusal(error)
  const generic = () => {
    if (phase === 'kiosk_lookup') return i18n.t('errors.kiosk_lookup_failed')
    return i18n.t(preflight ? 'errors.tx_refused_preflight' : 'errors.tx_failed')
  }
  // "MUST SAY WHY": an unmapped-but-decodable cause rides as a preflight-only SECOND line, never invented — a MAPPED abort still stands alone untouched (07-18 law below).
  const with_reason = (/** @type {string | null} */ reason) =>
    reason ? i18n.t('errors.tx_refusal_reason', { headline: generic(), reason }) : generic()
  const abort = parse_move_abort(error)
  if (abort) {
    const key = TABLE[abort.module]?.[abort.code]
    if (key) return i18n.t(key)
    if (!preflight) return generic() // EXECUTED + unmapped — unchanged, no invented reason
    return with_reason(i18n.t('errors.tx_refusal_reason_unmapped', { module: abort.module, code: abort.code }))
  }
  const text = to_message_string(error)
  const gas = gas_balance_copy(text) // pre-exec gas-selection / insufficient-balance — humanize BEFORE the jargon gate
  if (gas) return gas
  // lock-race / equivocation / sponsor gas-coin contention — no digest, nothing charged, ALWAYS retryable (BEFORE the jargon gate — a locked object id trips it).
  if (text && LOCK_RACE_RE.test(text)) return i18n.t('errors.tx_lock_race_retry')
  // structural $kind (abort_copy_structural_kind.js) OUTRANKS raw free text — a gRPC description is un-vetted, sometimes literally "Unknown error", which would pass the jargon gate untranslated.
  const kind_key = structural_kind_copy(error)
  if (kind_key) return preflight ? with_reason(i18n.t(kind_key)) : i18n.t(kind_key)
  if (text && !JARGON_RE.test(text)) return text // already a human message
  return generic() // chain blob / empty / jargon, no structural kind → the honest generic line, never invented
}

/** Back-compat alias — the historical name every existing caller (tx.js, dungeon_store) imports. One home. */
export const humanize_abort = humanize_tx_error

// ── side-signal hooks (a refusal fingerprint IS a detection signal, not just error copy) ────────────────────
// Fire `listener` off the main throw path via a guarded microtask — the throw itself must never depend on, or
// be broken by, a registered side effect. Shared by every hook below (marker-refusal, maintenance-pause).
function fire(/** @type {(() => void) | null} */ listener) {
  if (!listener) return
  queueMicrotask(() => {
    try {
      listener()
    } catch {
      /* a side-effect hook must never break a throw path */
    }
  })
}

// fight-marker refusal hook (a live gap fix): abort 111 (`fight::ECharacterMarked`, mark_seated) means
// an UNOPENED FightOutcome blocks this character — the exact state the pending-outcomes auto-open discharges.
// The refusal itself is a DETECTION signal ("auto open whenever detected"), so the one throw home below kicks
// the registered handler (dungeon_store.js tail wires it to the shared auto-open entry, announce mode). No
// import is added here (the consumer registers), so this classifier stays leaf-clean.
/** @type {(() => void) | null} */
let marker_refusal_listener = null

/** Register THE handler kicked on every abort-111 refusal (one consumer — last registration wins). */
export function on_marker_refusal(/** @type {() => void} */ cb) {
  marker_refusal_listener = cb
}

// S-84 maintenance-pause hook: `version::assert_enabled` (module "version", code 102 — ENotEnabled, the SAME
// shape across every package: core/engine/spells/social) fires whenever a package ships/re-enters DARK. This
// is the REACTIVE net for the CONTRACTS PAUSED modal (contracts_paused_modal.tsx registers it) — it catches a
// mid-session pause instantly, without waiting for the boot/focus poll. EWrongVersion (101, a stale-client
// cache) is a DIFFERENT, real bug class and deliberately does NOT kick this hook.
/** @type {(() => void) | null} */
let maintenance_listener = null

/** Register THE handler kicked on every version/102 (dark-ship) refusal (one consumer — last registration wins). */
export function on_maintenance_abort(/** @type {() => void} */ cb) {
  maintenance_listener = cb
}

/**
 * The ONE way a tx path throws a chain failure: a player-copy `.message` (via humanize_tx_error, so every
 * downstream toast / store.error shows copy, never "[object Object]") that STILL carries the raw structured
 * abort on `.cause` — so numeric classification (claim_race's per-room-claim discrimination) keeps working.
 * Side signals: a `fight.111` abort (marked character — unopened result) kicks the marker-refusal hook above;
 * a `version.102` abort (package shipped/re-entered dark) kicks the maintenance-pause hook above.
 *
 * `preflight: true` = the THROW SITE proves nothing was signed/sent (the S-54 gas-guard's dry-run refusal:
 * simulate said would-fail → refused pre-sign, ZERO gas, NO digest). It stamps the established `SimulationError`
 * house marker — BEFORE the message bakes, so the honesty split above picks the "refused, no gas" copy — and the
 * burn-law classifiers (is_preflight_refusal here; error_preflight_marked in tx_digest_error.js) key on it.
 * 07-18 victory-card starvation: without the marker, the terminal-race settle refusal (the fullnode's dry-run
 * lagging the killing commit → simulated settlement::101 ENotTerminal) was byte-identical to an EXECUTED abort,
 * latched 'executed_failure', starved the fight core's retry engine, and the card skeletoned forever.
 * @param {unknown} raw the raw chain error (structured gRPC MoveAbort, string, or null)
 * @param {{ preflight?: boolean, phase?: 'kiosk_lookup' }} [opts]
 * @returns {Error}
 */
export function tx_error(raw, { preflight = false, phase } = {}) {
  const abort = parse_move_abort(raw)
  if (abort && abort.module === 'fight' && abort.code === 111) fire(marker_refusal_listener)
  if (abort && abort.module === 'version' && abort.code === 102) fire(maintenance_listener)
  // the message is humanized off a marker PROBE (same cause chain + the SimulationError name when preflight),
  // so the honesty split sees the provenance the raw chain blob itself cannot carry.
  if (phase === 'kiosk_lookup') game_log('buy', 'kiosk lookup failed before signing:', raw)
  const probe = preflight ? { name: 'SimulationError', cause: raw } : raw
  const err = new Error(humanize_tx_error(probe, { phase }), { cause: raw })
  if (preflight) err.name = 'SimulationError'
  return err
}
