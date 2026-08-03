// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// D137 — the voxel fight adapter's PURE FOLDS (the renderer-neutral data transforms), split out from
// voxel_fight_adapter.js so they're unit-testable in ISOLATION — the SAME discipline overlay_intents.js follows.
// The adapter proper imports the live stores + engine (context / auth / three), which drag browser-only modules
// (Enoki `window`, the WS env gate) that a node test harness can't load; these folds import ONLY the light,
// deterministic twins (dungeon_grid_of / get_mob_model / CHARACTER_MODELS / the spellbook seed) so the math is
// provable without a scene, a GPU, or a wallet.
//
// CONTRACT: every export is a pure `(inputs) -> value`. No store reads, no IO, no three.js scene work.

import { decode as decode_cell } from '@aresrpg/fight/los'
import { voids_from_shape_mask } from '@aresrpg/fight/board_state'
import { engine_view } from '@aresrpg/fight/project'
// get_aoe_cells is the ONE shape home the sim + chain use to enumerate a spell's affected cells (spell_targeting.js:
// CIRCLE/CROSS/RING/LINE/TBAR/CONE). The hover footprint below REUSES it verbatim so the telegraph can never
// diverge from what the reducer actually hits — never a second shape implementation.
import { get_aoe_cells } from '@aresrpg/sim/spell_targeting'
import { weapon_spell_template } from '@aresrpg/fight/predict_cast'
import { WEAPON_ATTACK_ID } from '@aresrpg/fight/weapon'

import { dungeon_grid_of } from '../game/screens/dungeon-grid.js'
import { get_mob_model } from '../game/data/mobs.js'
import { PLACEHOLDER_RIG_CLASS, character_model_urls } from '../game/screens/character-glb.js'
import {
  cast_requires_occupant,
  fight_spell,
  seat_spell_level,
  seat_spell_row,
} from '../game/screens/hud/fight-spells.js'

// The voxel board floats above the streamed terrain at a fixed designated origin (the cave-gen picks this in the
// real game path; here a flat pose WELL above the world_gen surface, mirroring the engine demo's ORIGIN so the
// board never buries inside a hill). Cell (0,0) min-corner; y = the flat floor level.
export const VOXEL_BOARD_ORIGIN = { x: 40, y: 260, z: 40 }

/**
 * Fold a live Dungeon record into `board.build(...)` args. The grid dims + obstacles + holes come from the D41
 * DETERMINISTIC seed grid (dungeon_grid_of), NOT the fixed 10×10 index window — that is exactly the geometry the
 * contract enforces and fight-overlay's board_render draws. MASK TOLERANCE (D75): if the record carries an
 * explicit `shape_mask`, pass it through (a future non-rectangular room); ABSENT ⇒ rect args (the engine's
 * build() composes the mask from obstacles/holes). Pure: seed-only, no store/IO.
 * @param {any} dungeon a get_dungeon() record (id + room_index seed the grid)
 * @param {{ x: number, y: number, z: number }} [origin] the board anchor (default the fixed voxel origin)
 * @returns {{ grid_w: number, grid_h: number, obstacles: {x:number,y:number}[], holes: {x:number,y:number}[], shape_mask?: unknown, anchor: { origin: {x:number,y:number,z:number} } }}
 */
export function build_args_from_dungeon(dungeon, origin = VOXEL_BOARD_ORIGIN) {
  const grid = dungeon_grid_of(dungeon)
  const args = {
    grid_w: grid.width,
    grid_h: grid.height,
    obstacles: (grid.obstacles ?? []).map(decode_cell),
    holes: (grid.holes ?? []).map(decode_cell),
    anchor: { origin },
  }
  // D75 forward → D231: the engine build now takes VOIDS — cells OUTSIDE the deterministic shape (render
  // nothing, unpickable; "squares are forbidden", the D25 move-module grid is the only shape author). The
  // complement is derived by `voids_from_shape_mask` (@aresrpg/fight/board_state), the ONE home the
  // simulator's own board derivation reads too. A mask-less (train-3) record ships none — the engine renders
  // the full rect (legacy records only; every D75+ dungeon carries a mask).
  const voids = voids_from_shape_mask(args.grid_w, args.grid_h, dungeon?.shape_mask)
  return voids.length ? { ...args, voids } : args
}

// ── WORLD-BOARD SEATING (robust grounding — pure math over sampled surfaces) ─────────────────────────────
// A world fight's board seats FLAT on open terrain. Sampling the ground at the SINGLE anchor column is
// unreliable BOTH directions: a low/forest/water column reads too low (or null → a player-Y fallback) → the
// board sinks BELOW the terrain; and terrain elsewhere in the footprint then pokes THROUGH it. The cure is to
// sample the WHOLE footprint and seat on the dominant HIGH plane (so the board is never below the land), then
// let the render-side footprint clear carve anything still poking above. These two folds are the pure core.

/**
 * Enumerate the integer ground columns to sample under a world board centred on (ax, az): a coarse grid over
 * the footprint AABB [ax±half_x]×[az±half_z], stepped by ~`step` metres (coarser than per-cell — a max/quantile
 * doesn't need every column, and a column scan isn't free). Pure.
 * @param {number} ax @param {number} az anchor world XZ (board centre)
 * @param {number} half_x @param {number} half_z board footprint half-extents (world m)
 * @param {number} step sample spacing (world m; floored to ≥1 block)
 * @returns {[number, number][]} integer [x, z] columns
 */
export function world_footprint_columns(ax, az, half_x, half_z, step) {
  const s = Math.max(1, Math.floor(step))
  const x0 = Math.floor(ax - half_x)
  const x1 = Math.floor(ax + half_x)
  const z0 = Math.floor(az - half_z)
  const z1 = Math.floor(az + half_z)
  const cols = /** @type {[number, number][]} */ ([])
  for (let x = x0; x <= x1; x += s) for (let z = z0; z <= z1; z += s) cols.push([x, z])
  return cols
}

/**
 * The board seat Y from the resolved footprint ground surfaces (each = a `ground_surface_y` result, the top solid
 * block's y). Seats on a HIGH quantile ("the dominant plateau" — robust to a lone peak/pit at the footprint edge)
 * + 1 (the top FACE the flat board rests on), so the board sits ON TOP of the land: never below it, and only the
 * top ~(1−quantile) fraction pokes above (the render-side footprint clear carves that). Returns null when NOTHING
 * resolved (whole footprint unstreamed/forest/water) — the caller falls back to the nearby player's Y. Pure.
 * @param {number[]} surfaces resolved surface Ys (non-null `ground_surface_y` results)
 * @param {number} [quantile] high-plane quantile ∈ [0,1] (default 0.9 — top-of-terrain, outlier-robust)
 * @returns {number | null} the flat board floor Y, or null if no surface resolved
 */
export function world_seat_from_surfaces(surfaces, quantile = 0.9) {
  if (!surfaces || surfaces.length === 0) return null
  const sorted = [...surfaces].sort((a, b) => a - b)
  const q = Math.min(1, Math.max(0, quantile))
  const idx = Math.min(sorted.length - 1, Math.round(q * (sorted.length - 1)))
  return sorted[idx] + 1 // feet_of — the top face of the dominant-high ground block
}

/** A fight row's gender, decoded off the two shapes the chain/read-model hand us. The DECODE is this
 *  surface's (it knows its own record shape); the rig RULE it feeds is shared. */
const is_male_fighter = (fighter) => !(fighter.male === false || fighter.sex === 'female')

/**
 * The GLB url for a fighter — the template-id law, resolved through `character_model_urls`, the ONE home the
 * roam world, remote players and the simulator board also read, so a voxel avatar matches the plane. Player:
 * the escrowed character's CLASS body GLB; a class with no rig uses the same gender-matched Senshi placeholder
 * as the roam avatar, never the engine avatar's implicit male default.
 * Mob: get_mob_model keyed on fighter.variant (= the chain mob template id). Pure.
 * @param {{ is_player?: boolean, class_id?: string, variant?: string, sex?: string, male?: boolean, name?: string,
 *   identity_resolved?: boolean }} fighter
 * @returns {string | undefined} a public GLB url
 */
export function glb_variant_of(fighter) {
  if (fighter.is_player)
    return character_model_urls(fighter.class_id, is_male_fighter(fighter), { fallback: PLACEHOLDER_RIG_CLASS }).body
  // The identity book's honest verdict (#1993 WP3): an unresolved mob renders the built-in capsule rather than
  // requesting a GLB for a species nobody has named. `variant` is now guaranteed to be that mob's OWN template id.
  if (fighter.identity_resolved === false) return undefined
  // DECLINED-WITH-WHY (#1993 WP3, audit row voxel_fight_folds.js:124). `name` here looks like a second identity
  // home but is not one: `get_mob_model` keys the ASSET CATALOG by template id first and by appearance name only
  // as a catalog key for rows the corpus publishes under a name rather than an id. That is a content-catalog
  // keying question owned by the seed corpus, not an identity choice made at this consumer — the identity is
  // already decided (one book, one row) before either key is tried, and dropping the name key here would blank
  // every legitimately name-keyed rig. The real close-out is the corpus keying every row by template id; until
  // then this arm is load-bearing and stays.
  return get_mob_model({ variant: fighter.variant, name: fighter.name }).url
}

/**
 * [D242] The HAIR GLB url for a fighter, or undefined. A PLAYER gets their class/gender `_hair` mesh from the
 * SAME `character_model_urls` door the roam avatar (embed_voxel) mounts — so a fight avatar is NOT bald (D242
 * rejects a hairless fight avatar). Mobs and hairless class/gender rows resolve undefined (the engine avatar home
 * simply skips hair — bald, not broken); rig-less classes use the roam avatar's Senshi placeholder. Pure — mirrors
 * glb_variant_of.
 * @param {{ is_player?: boolean, class_id?: string, sex?: string, male?: boolean }} fighter
 * @returns {string | undefined}
 */
export function hair_variant_of(fighter) {
  if (!fighter.is_player) return undefined
  return character_model_urls(fighter.class_id, is_male_fighter(fighter), { fallback: PLACEHOLDER_RIG_CLASS }).hair
}

/**
 * Fold a fight-slice Fighter into an `entity_upsert(...)` spec. glb_variant = the D136 body GLB url; hair_url =
 * the player's class/gender hair mesh (D242 — undefined for mobs/bald rows); colors = the seat's [skin,armor,trim]
 * triple. hair_url + colors are APPLIED by the engine avatar (D242 — board_entities forwards them into
 * create_character_avatar, matching the roam avatar + cave-mob rigs). facing is cosmetic (team 0 south / team 1
 * north). [faithful-mob-sizes 2026-07-13] (mob sizes must be source-asset faithful) RETIRED the
 * `scale` field this fold used to carry (D255's mob_scale_of → get_mob_model().size = 1.4·wire, forwarded into
 * create_character_avatar as an explicit height target): board_entities.js now passes `pixel_filter: kind ===
 * 'mob'`, and mob_model.js's prepare_mob_render takes that alone as its cue to render the mob at its INTRINSIC
 * (asset-authored) height rather than a blanket normalise — no scale field needed. Pure.
 * [cosmetics-in-fights] worn = the fighter's resolved equipped hat/cloak slots ({ head, back }, the SAME shape
 * resolve_worn_cosmetics feeds the roam avatar's create_worn_cosmetics rig — board_entities mounts them on the
 * fight rig's Head/cape bones). Forwarded verbatim; a fighter with no cosmetics folds `worn:null`. The fold does
 * NOT resolve worn itself — that join needs the /v1 character read-model + encyclopedia templates (frontend,
 * not the renderer-neutral fight core), so the caller attaches `fighter.worn` before folding.
 * @param {any} fighter a fight.fighters value
 * @returns {{ id: string, kind: string, glb_variant: string | undefined, hair_url: string | undefined, colors: unknown, cell: {x:number,y:number}, facing: string, worn: { head: unknown, back: unknown } | null }}
 */
export function entity_spec_from_fighter(fighter) {
  return {
    id: fighter.id,
    kind: fighter.is_player ? 'player' : 'mob',
    glb_variant: glb_variant_of(fighter),
    hair_url: hair_variant_of(fighter),
    colors: fighter.colors ?? null,
    cell: { x: fighter.cell.x, y: fighter.cell.y },
    facing: fighter.team === 1 ? 'north' : 'south',
    worn: fighter.worn ?? null,
    // [⑤c invisibility veil] the fold owns invisibility (f.invisible); carry it as a stable boolean so the
    // adapter can drive the engine's heat-haze visual_effect from ONE fold truth (the old packet-driven
    // wire_fight_invisibility orphaned when the sim-door rework dropped its status snapshots). Never undefined
    // → the veil clears honestly on reveal. The self-vs-other RENDER decision (self/ally veil, enemy hidden)
    // is the adapter's, which knows my_entity_id or team; the spec only reports the chain-truth flag.
    invisible: !!fighter.invisible,
  }
}

/**
 * Fold a fightCastResult event into the ordered beat SEQUENCE the adapter plays: the caster's attack beat,
 * then one target beat per damage/heal number. `text` is FULLY COMPOSED here (i18n stays
 * dapp-side — the engine only rasterizes) as the signed number. Pure + order-preserving so the bar-release
 * (which keys off each beat's impact-frame resolution) fires in the same order the impacts land.
 *
 * ORDER LAW: a killing blow reads hit-reaction → floating number → THEN death → depop, NEVER
 * a straight death anim (the mob must never visibly stand back up between the hit and the death animation). So a lethal effect is
 * NOT its own 'death' beat here — it is the SAME hit beat carrying the float, flagged `then_death`; the adapter
 * SEQUENCES the death beat off that hit's impact resolve. (board_entities' `entity_beat` OVERWRITES the live
 * beat, so emitting hit+death together would clobber the flinch — the death MUST chain after the hit's done.)
 * `release: false` on an effect suppresses its bar-release (multi-mob split — only the finishing hit releases).
 * @param {{ entity_id: string, is_critical?: boolean, effects?: { target_id: string, damage?: number, heal?: number, killed?: boolean, release?: boolean }[] }} packet
 * @returns {{ id: string, anim: string, float: { text: string, kind: string } | null, release_target: string | null, then_death: boolean, hp?: {target_id:string,new_health:number,killed:boolean} }[]}
 */
export function beats_from_packet(packet) {
  /** @type {{ id: string, anim: string, float: { text: string, kind: string } | null, release_target: string | null, then_death: boolean, hp?: {target_id:string,new_health:number,killed:boolean} }[]} */
  const beats = []
  // the caster's swing (no float on the caster — the number rides the struck target below).
  beats.push({ id: packet.entity_id, anim: 'attack', float: null, release_target: null, then_death: false })
  const crit = !!packet.is_critical // [W6 #4] a critical cast styles every damage number distinctly (crit font)
  for (const e of packet.effects ?? []) {
    const dmg = e.damage ?? 0
    const heal = e.heal ?? 0
    if (dmg <= 0 && heal <= 0) continue
    /** @type {{ id:string, anim:string, float:{text:string,kind:string}, release_target:string|null, then_death:boolean, hp?:{target_id:string,new_health:number,killed:boolean} }} */
    const beat = {
      id: e.target_id,
      anim: 'hit', // every struck target flinches; a kill chains its death off this beat via then_death (adapter).
      float:
        heal > 0 && dmg <= 0 ? { text: `+${heal}`, kind: 'heal' } : { text: `-${dmg}`, kind: crit ? 'crit' : 'damage' },
      // the mob-cast HP hold (hold_incoming_hit) is released on THIS beat's impact-frame resolution (the 2D
      // overlay's play_cast_packet did it there; in voxel-only mode this beat's resolve is the release point).
      // A non-finishing multi-mob hit (release === false) keeps the bar held for the LATER mob that finishes it.
      release_target: dmg > 0 && e.release !== false ? e.target_id : null,
      then_death: dmg > 0 && !!e.killed, // lethal ⇒ adapter plays death AFTER this hit's impact (order law).
    }
    if (Number.isFinite(e.new_health))
      beat.hp = { target_id: e.target_id, new_health: e.new_health, killed: !!e.killed }
    beats.push(beat)
  }
  return beats
}

/**
 * [trap-on-mob] Split a mob's move path into walk SEGMENTS around each trap crossing, so the paced replay walks
 * to a trap cell, PAUSES for its trigger beat, then RESUMES the rest (walking into a
 * trap pauses client-side to display the hit animation, then resumes the move right after).
 * Each returned step is a contiguous sub-path to walk; a non-null `trap` means "after arriving, play the trap
 * trigger at this segment's LAST cell". No crossings ⇒ one whole-path step (the unchanged plain walk). The trailing
 * post-trap remainder is its own trap-less step (the RESUME). Gait stays derived from the WHOLE path by the caller
 * (D303), never per-segment. Pure — unit-tested. @param {{x:number,y:number}[]} path move path (EXCLUDES start)
 * @param {{index:number,cell:{x:number,y:number},damage:number}[]=} trap_hits crossings, ascending by index
 * @returns {{ walk: {x:number,y:number}[], trap: {index:number,cell:{x:number,y:number},damage:number}|null }[]}
 */
export function split_move_at_traps(path, trap_hits) {
  if (!trap_hits?.length) return [{ walk: path ?? [], trap: null }]
  const steps = []
  let from = 0
  for (const hit of trap_hits) {
    steps.push({ walk: path.slice(from, hit.index + 1), trap: hit })
    from = hit.index + 1
  }
  if (from < path.length) steps.push({ walk: path.slice(from), trap: null }) // the RESUME leg
  return steps
}

/**
 * #950 → #1042 — THE PATH PREVIEW IS A REACH VERDICT ON THE HOVERED CELL. A dark-green path is the answer to
 * "click here and I walk this route", so it may only be drawn for a cell the walk can actually END on: the
 * hovered destination is either inside the REACHABILITY THE REDUCER OWNS (`project.move_wash`'s `reach` — the
 * tackle-aware set, the chain's own escape contest folded cell-for-cell) and the whole walk paints, or it is
 * not and NOTHING paints. #950 made this a CLIP (keep the prefix inside the reach), which fixed the lying
 * path but left a truncated route drawn under a cursor sitting somewhere unreachable (#1042). A gate has no
 * such half-answer, and it needs no separate "is this cell reachable" derivation: `move_wash` stays the one
 * home for reach, exactly as paint() washes it green. The verdict reads EVERY cell rather than just the
 * hovered one — with a flood-fill reach the two are the same answer, and the general form owes nothing to
 * that invariant: no cell is ever painted dark-green that the wash has not painted light-green.
 * @param {number[]} path start-exclusive ENCODED path cells (the last is the hovered destination)
 * @param {Set<number>} reach the wash's reach set
 * @returns {number[]} the whole walk when the walk is reachable, otherwise nothing
 */
export function reachable_hover_path(path, reach) {
  const cells = path ?? []
  return cells.length && cells.every((cell) => reach?.has(cell)) ? cells : []
}

/**
 * Append one observed mob-turn packet without collapsing repeated casts. Snapshot/event pumps may emit the same
 * spell id twice; cardinality and arrival order are presentation facts, so casts are an array rather than a
 * spell-keyed slot. Pure reducer used by the adapter's turn buffer.
 * @param {{move:any,casts:any[]}|null|undefined} buffer
 * @param {'move'|'cast'} kind
 * @param {any} packet
 * @returns {{move:any,casts:any[]}}
 */
export function append_mob_turn_beat(buffer, kind, packet) {
  const next = { move: buffer?.move ?? null, casts: [...(buffer?.casts ?? [])] }
  if (kind === 'move') next.move = packet
  else next.casts.push(packet)
  return next
}

/** Move first, then every cast in arrival order. @param {{move:any,casts:any[]}} buffer @returns {any[]} */
export function mob_turn_steps(buffer) {
  return [...(buffer?.move ? [buffer.move] : []), ...(buffer?.casts ?? [])]
}

/** A self-cast keeps the caster's current facing; any other target may re-face the attack beat. */
export function cast_face_target(caster_cell, target_cell) {
  if (!target_cell) return undefined
  if (caster_cell && caster_cell.x === target_cell.x && caster_cell.y === target_cell.y) return undefined
  return target_cell
}

/**
 * #170 (5th recurrence, the RE-BEAT flavor): the death VISUAL is no longer triggered by an event-shaped 'death'
 * beat kind (up to 4 producers each built their own redundant one for the same kill — receipt wave, poll
 * adoption, a second poll…). It is derived from the PRESENTED-STATE TRANSITION instead — the studio's own
 * reduce/observe idiom (aresrpg-legacy player_health.js's health-fold is the precedent: `last_health !==
 * character.health` guards the emit — death===death is a no-op by construction). `was_dead` is the last-OBSERVED
 * `dead` boolean for this fighter (a primitive, never an object reference); this reports true ONLY on the
 * genuine false→true edge. Whichever of the N redundant kill sources gets here FIRST wins — every later
 * re-assertion of the same still-dead fighter is a no-op, no per-source dedup bookkeeping needed. The reverse
 * edge (a committed-fold genuine revival — the SAME door #260's poofed guard uses) reports false here (never
 * itself a trigger) but the caller still records the fresh value, so a LATER real re-death is a genuine new
 * false→true edge — correct, not suppressed. PURE: the caller owns writing `dead` into its own accumulator
 * (mirrors entity_fold_action below — a verdict function, never a mutation).
 * @param {boolean} was_dead @param {boolean} dead @returns {boolean} */
export const is_death_edge = (was_dead, dead) => dead && !was_dead

/**
 * The per-fighter VERDICT the fold's entity reconcile executes — the mob death-despawn + position-reconcile rules
 * as a PURE decision so they're unit-testable without the browser adapter (the imperative half drives board.* off
 * this). Four kinds:
 *
 *  • 'despawn' — a dead fighter that still has a rig and isn't already dying: play its death beat ONCE then poof
 *      (never re-stand). `is_dying` dedups a cast-kill's death beat against this fold's, so EXACTLY ONE death beat
 *      fires per corpse (death anim, then depop — never loop back to idle).
 *  • 'skip'    — nothing to do: a dead fighter already dying / already absent, or a LIVING fighter whose
 *      in-flight walk / paced replay owns its position this frame (re-placing would teleport it mid-lerp).
 *  • 'walk'    — a LIVING FIGHTER (mob or player) whose chain cell drifted from where its rig stands, with no
 *      walk/replay owning it (the fold moved it but a beat didn't — a snapshot-reset poll / a packet-less move,
 *      and in coop every peer action an observing seat folds off the journal): smooth-walk it to `to` via the
 *      existing walk path instead of a teleport-snap (bodies APPROACH, never blink). Never during PLACEMENT —
 *      a placement pick PLACES a body, it does not move one, so it snaps (the rest of the phase agrees: the
 *      D290 re-face rides the same upsert).
 *  • 'upsert'  — the living default create/refresh/snap at the chain cell: a NEW id or a fighter already on its cell.
 *
 * ONE DEAD RULE: player or mob, live or snapshot rebuild, active or terminal — a dead row NEVER upserts. A live
 * rig gets one death beat + removal; an already-dying or absent rig stays skipped. This single branch prevents
 * both lingering dead players and a snapshot reconcile recreating a dead mob.
 *
 * #170 + #450 POOFED-CORPSE GUARD (the LIFECYCLE half, distinct from the retirement HP projection): once a rig
 * has POOFED this fight it stays down while it is dead in ANY projection — committed (`committed_dead`, which
 * holds it down through a re-armed death beat's engine_view.dead flicker, #170), presented (`fighter.dead`, the
 * post-ack fold), or a still-QUEUED kill claim in the wave (`queued`, the pre-ack window death_hold masks off
 * engine_view.dead). The ONLY door back is a genuine revive — alive in ALL THREE at once (a prediction rolled
 * back, or a committed dead→alive divergence correction). This closes #450: a local predicted kill has
 * committed_dead=false for its whole life (the receipt folds the death only at end-turn), so keying the door back
 * on committed_dead ALONE re-read every predicted corpse as a revive and re-armed the death beat until end-turn.
 * And a committed-dead fighter never SPAWNS a fresh model.
 *
 * @param {{ id: string, dead?: boolean, is_player?: boolean, cell: {x:number,y:number} }} fighter a fight.fighters value
 * @param {{ winner: number, has_entity: boolean, is_dying: boolean, walking: boolean, replay_owned: boolean,
 *   placed: {x:number,y:number} | null, queued?: boolean, poofed?: boolean, committed_dead?: boolean,
 *   placement?: boolean }} ctx the
 *   adapter's live per-id state (mirrors + the AUTHORITATIVE committed liveness — never the flickering engine_view.dead)
 * @returns {{ kind: 'despawn' | 'skip' | 'walk' | 'upsert', to?: {x:number,y:number} }}
 */
export function entity_fold_action(
  fighter,
  {
    has_entity,
    is_dying,
    walking,
    replay_owned,
    placed,
    queued = false,
    poofed = false,
    committed_dead = false,
    placement = false,
  }
) {
  // #170 + #450 POOFED-CORPSE GUARD: a rig already poofed this fight stays DOWN — never re-upsert a fresh
  // (default-orientation) model, never re-fire death — while it is dead in ANY projection. The door back is a
  // GENUINE revive: alive in EVERY sense. #170 covered the committed flicker (committed_dead holds it down even
  // when engine_view.dead momentarily reads false). #450 adds the PREDICTED-KILL CLAIM WINDOW: a local predicted
  // kill (my own cast) has committed_dead=FALSE for its whole life (the committed fold only folds the death at the
  // end-turn receipt), so `committed_dead` alone read every predicted corpse as a "revive" and re-armed the death
  // beat each reconcile — looping until end-turn. A predicted corpse is still dead: fighter.dead=true once the
  // fold shows it (post-ack), OR its kill claim is still QUEUED in the wave (pre-ack — death_hold holds
  // engine_view.dead false, but `queued` sees the unretired claim). Hold down unless ALL three say alive; the ONLY
  // upsert is the genuine divergence-correction revive (prediction rolled back / committed dead→alive), which
  // clears every flag at once.
  if (poofed) return committed_dead || fighter.dead || queued ? { kind: 'skip' } : { kind: 'upsert' }
  // ONE DEAD RULE, amended: a chain-dead fighter whose beats are STILL in the unacked wave keeps its rig —
  // its own sequenced hit → number → death owns the despawn (the out-of-band fold death raced it before).
  if (fighter.dead) return has_entity && !is_dying && !queued ? { kind: 'despawn' } : { kind: 'skip' }
  // BELT-AND-BRACES: a COMMITTED-dead fighter with NO live rig never SPAWNS a fresh model (which would re-play its
  // death from an idle pose) — even on an engine_view.dead flicker that precedes its poof. A live rig refreshes in place.
  if (committed_dead && !has_entity) return { kind: 'skip' }
  // living: an in-flight walk / paced replay owns the position this frame → leave it (the mid-lerp teleport guard).
  if (has_entity && (walking || replay_owned)) return { kind: 'skip' }
  // A living FIGHTER drifted from its placed cell with no beat owning it → smooth-walk (the fold's position safety
  // net). #1138/#1139: this used to require `is_mob`, which closed the net on the one case it matters most in coop —
  // an OBSERVING seat folds a peer's committed move over the journal transport, which produces no paced wave turn,
  // so this verdict is the ONLY channel that can move a peer's rig. Gated on mobs, the occupancy flipped while the
  // model stood still (#1138), and a drifted anchor was corrected by a snap instead of a walked route from the
  // previous cell (#1139). Nothing about "the fold moved it but a beat didn't" was ever mob-specific — except in
  // PLACEMENT, where a pick PLACES a body rather than moving one and must still snap.
  if (!placement && has_entity && placed && (placed.x !== fighter.cell.x || placed.y !== fighter.cell.y))
    return { kind: 'walk', to: { x: fighter.cell.x, y: fighter.cell.y } }
  return { kind: 'upsert' }
}

/**
 * The board adapter's ONE fight authority — `engine_view` derived from the CORE at read time (the live path is
 * fight/project.js `fight_view`, the app-wide memoized twin; this pure form serves the headless tests). The
 * game-core `state.fight` mirror this used to guard against is DELETED OUTRIGHT (S2 mirror kill, 2026-07-17):
 * its async-pump lag was the BOOT23 "mob movement rollback" — the lagged copy still held a mob's MASKED
 * pre-turn cell at a wave turn's ack, so the fold's position safety net walked the rig BACK, then forward
 * again (regression-locked by voxel_fight_ack_window.test.js).
 * @param {{ core: any, roster?: any[] }} inputs the live fight_store state (+ a roster override for tests —
 *   production roster rides the core's own ctx.roster)
 * @returns {any} the FightSlice-shaped view reconcile derives phase/entities/paint from (null = no fight)
 */
export function board_fight_authority({ core, roster = core?.ctx?.roster ?? [] }) {
  return engine_view(core, { roster })
}

/**
 * AP-AFFORDABILITY WASH GATE (fixes the range highlight persisting post-cast): the armed id the
 * WASH should paint for — null once the caster's LIVE folded AP can't afford one more cast, so the blue cast
 * ranges clear and the idle green MP range returns the moment the budget is spent (the deck's greyed sockets
 * and the board's castable-empty gate say the same thing — one budget truth, three surfaces). The caller
 * resolves the weapon sentinel's cost off the escrow row (this module never imports the game-core module).
 * `seat` is the caster's composed build (its fight-view / escrow row) — the cost is the SEAT'S rank's cost, not
 * level 1's (#1077): an upgraded spell costs more, so pricing it at rank 1 kept the wash painting a cast the
 * budget could no longer buy.
 * @param {{ armed_spell_id: string | null, active_ap: number | null | undefined, is_weapon?: boolean,
 *   weapon_ap_cost?: number, seat?: { spell_levels?: Record<string, number> } | null }} inputs
 * @returns {string | null}
 */
export function wash_armed_spell({ armed_spell_id, active_ap, is_weapon = false, weapon_ap_cost = 0, seat = null }) {
  if (!armed_spell_id) return null
  if (is_weapon) return (active_ap ?? 0) >= weapon_ap_cost ? armed_spell_id : null
  // #1093 — AN ARM THE BOARD CANNOT PAINT IS NOT AN ARM. `seed_range_of` is the ONE door to the seat's rank
  // row; when it refuses (an id the corpus resolves to nothing, or a rank the corpus never authored) there is
  // no blue cast range to draw. Pricing that ABSENT row at 0 AP made it read as affordable, and an affordable
  // arm is exactly what flips the board into cast mode and suppresses the green MP wash — so the green went
  // off and the blue never came on, leaving every base channel dark on a live turn. The idle MP wash keeps the
  // board instead, and the adapter names the unpaintable arm out loud (no silent failure).
  if (!seed_range_of(armed_spell_id, seat)) return null
  const cost = seat_spell_row(seat, fight_spell(armed_spell_id))?.ap ?? 0
  return (active_ap ?? 0) >= cost ? armed_spell_id : null
}

/**
 * The [rmin, rmax] range for an armed spell — read off the SAME on-chain spell row DungeonBoard's cast_params
 * reads (fight-spells.js, keyed by the name_key the hand arms with), so the voxel cast wash == the 2D cast wash
 * == DungeonBoard's `castable` gate. Returns null when the spell can't be resolved (no wash, never a broken
 * 0-range gate). Pure.
 * @param {string} armed_spell_id
 * @param {{ spell_levels?: Record<string, number> } | null} [seat] the caster's composed build (its rank)
 * @returns {[number, number] | null}
 */
export function seed_range_of(armed_spell_id, seat = null) {
  const range = seat_spell_row(seat, fight_spell(armed_spell_id))?.range
  return Array.isArray(range) && range.length === 2 ? [range[0], range[1]] : null
}

/**
 * The legality flags for an armed spell — the spell_target twin inputs (P1 self-cast root). Read off the SAME
 * on-chain row seed_range_of resolves, so the wash, the hover-AoE and DungeonBoard's `castable` gate all share
 * one truth: `los` (line_of_sight gates aim), `linear` (line-launch: orthogonal only), `free_cell` (target must
 * be an EMPTY cell — traps), `places_trap` (the row carries a PLACE_TRAP effect — the caller then feeds the
 * caster's own live trap cells to cast_range_set_dungeon's `trap_cells` drop, the 1.29 no-stack wash/gate),
 * `requires_occupant` (#1741 — a zero-area single-target DAMAGE spell may only aim at a VISIBLE occupant; the
 * caller then feeds the projection's visible-occupancy set to `occupant_cells`, free_cell's rule inverted).
 * Unresolved spell → the safe defaults (LOS on, no line, any occupancy, no placement). Pure.
 * @param {string} armed_spell_id
 * @param {{ spell_levels?: Record<string, number> } | null} [seat] the caster's composed build (its rank)
 * @returns {{ los: boolean, linear: boolean, free_cell: boolean, modifiable_range: boolean,
 *   places_trap: boolean, requires_occupant: boolean }}
 */
export function seed_cast_flags_of(armed_spell_id, seat = null) {
  const lvl = seat_spell_row(seat, fight_spell(armed_spell_id))
  return {
    los: lvl?.line_of_sight !== false,
    linear: lvl?.linear === true,
    free_cell: lvl?.free_cell === true,
    modifiable_range: lvl?.modifiable_range === true,
    places_trap: (lvl?.effects ?? []).some((e) => e?.kind === 'PLACE_TRAP'),
    requires_occupant: cast_requires_occupant(lvl),
  }
}

// #1993 WP5 — `cast_whiffed` is DELETED. It was a second landing classifier beside the renderer's own
// authorization (#1859): a kind-only scan that could not see a payload (a fully dodged drain still emits a
// `status` beat) and stopped only at the next `cast` (so a walk's trap detonation counted as the cast in front
// of it). The one home is `@aresrpg/fight/cast_record` — `cast_resolution`, derived once at bind and read by
// both the log line and the impact package.

/**
 * The FULL board footprint an armed spell paints while hovering a target cell — the UNION of every base
 * effect's zone, each enumerated by the SAME `get_aoe_cells` the sim/chain reducer uses (one shape home:
 * a cross-1 effect yields its 5-cell plus, a circle-2 its disc, a glyph its whole placement zone). Pure.
 * @param {import('@aresrpg/sim').SpellEffect[]} effects the level's normalized base effects
 * @param {{ x: number, y: number }} target hovered cell (anchors every shape)
 * @param {{ x: number, y: number }} caster caster cell (orients LINE/CONE/TBAR)
 * @returns {{ x: number, y: number }[]} deduped cells; `[target]` when the union is empty (POINT-only spell)
 */
export function footprint_of_effects(effects, target, caster) {
  const union = (effects ?? []).flatMap((effect) => get_aoe_cells(effect, target, caster))
  // dedupe by cell key (a Map keyed on `x,y` collapses overlaps between effects); empty ⇒ the target cell.
  const deduped = [...new Map(union.map((c) => [`${c.x},${c.y}`, { x: c.x, y: c.y }])).values()]
  return deduped.length ? deduped : [{ x: target.x, y: target.y }]
}

/**
 * The hover-telegraph footprint for an ARMED spell around the hovered `target`, resolved off the SAME on-chain
 * spell row seed_range_of reads (its normalized level's base_effects). Unresolved (the weapon sentinel has no
 * seed row) ⇒ `[target]` — the melee single cell. Pure.
 * @param {string | null | undefined} armed_spell_id
 * @param {{ x: number, y: number }} target
 * @param {{ x: number, y: number }} caster
 * @param {{ spell_levels?: Record<string, number> } | null} [seat] the caster's composed build (its rank)
 * @returns {{ x: number, y: number }[]}
 */
export function spell_footprint(armed_spell_id, target, caster, seat = null) {
  // #387 — the WEAPON strike is a zone like any other now: its category's cell set comes from the same
  // `weapon_spell_template` the board prices the swing from, so the hover paints the exact cells the chain
  // will hit. The sentinel still has no seed row — it never needed one; it needs the seat's weapon.
  const effects = weapon_strike_effects(armed_spell_id, seat) ?? spell_level_effects(armed_spell_id, seat)
  return footprint_of_effects(effects, target, caster)
}

/** The armed WEAPON strike's normalized effects (its zone rides them), or null when a spell is armed. */
function weapon_strike_effects(armed_spell_id, seat) {
  if (armed_spell_id !== WEAPON_ATTACK_ID || !seat?.weapon) return null
  return weapon_spell_template(seat.weapon)?.levels?.[0]?.base_effects ?? []
}

/** A seed spell's effects at the seat's OWN rank — the AoE is a per-RANK fact (a zone widens with the level). */
function spell_level_effects(armed_spell_id, seat) {
  const spell = fight_spell(armed_spell_id)
  return spell?.template?.levels?.[seat_spell_level(seat, spell) - 1]?.base_effects ?? []
}

/**
 * True when the armed spell PLACES A GLYPH (its on-chain row's role is 'glyph') — the hover footprint then
 * paints the orange glyph tint (via 'glyph_hover', hover_footprint_plan below) instead of the red AoE strike
 * wash. Pure.
 * @param {string | null | undefined} armed_spell_id
 * @returns {boolean}
 */
export function is_glyph_spell(armed_spell_id) {
  return fight_spell(armed_spell_id)?.role === 'glyph'
}

/**
 * [#238 regression, v1.12.41] Hover-footprint paint plan: which TRANSIENT channel to paint the current hover
 * preview into (if any) and which transient channel(s) to clear. `foot_cells` is already the resolved zone
 * shape (spell_footprint — the sim's own get_aoe_cells, one shape home); this only ROUTES it.
 *
 * A glyph-placing spell's preview renders through 'glyph_hover' — its OWN transient channel — NEVER the
 * persistent 'glyph' channel paint() owns authoritatively from fight.my_glyphs (board_highlight_style.js:
 * CHANNELS.glyph vs CHANNELS.glyph_hover, same tint, split channels). Before this split, an idle hover (no
 * footprint — no spell armed, or the cursor over a non-castable cell) called clear_states('glyph') directly,
 * which faded out and removed the caster's OWN already-placed zone mid-turn the instant the mouse moved
 * without a glyph spell armed — the reported "AoE glyph zone disappeared" regression. Routing through a
 * channel 'aoe'/'glyph_hover' never shares with the persistent paint makes that collision structurally
 * impossible, not just avoided by caller discipline. Pure.
 * @param {string | null | undefined} armed_spell_id
 * @param {{x:number,y:number}[]} foot_cells
 * @returns {{ paint: { channel: 'aoe' | 'glyph_hover', cells: {x:number,y:number}[] } | null, clear: ('aoe' | 'glyph_hover')[] }}
 */
export function hover_footprint_plan(armed_spell_id, foot_cells) {
  if (!foot_cells.length) return { paint: null, clear: ['aoe', 'glyph_hover'] }
  const channel = is_glyph_spell(armed_spell_id) ? 'glyph_hover' : 'aoe'
  return { paint: { channel, cells: foot_cells }, clear: [channel === 'aoe' ? 'glyph_hover' : 'aoe'] }
}

/**
 * The actor whose turn the player can SEE now. During paced replay the presentation clock deliberately trails
 * the chain clock; once replay drains, the authoritative active actor takes over. Terminal state has no live
 * turn. This mirrors FightTimeline's active-card projection and never reads wave/fold internals.
 * @param {any} fight projected engine view
 * @returns {string | null}
 */
export function visible_turn_actor_id(fight) {
  if (!fight || fight.winner !== -1) return null
  return fight.presenting ? (fight.presenting_entity_id ?? null) : (fight.active_entity_id ?? null)
}

/**
 * Pure observed-delta plan for the glyph turn-tick flare. `previous_visible_actor_id === undefined` means the
 * presentation just mounted and establishes a baseline without inventing a tick; `null → actor` is a genuine
 * placement-to-active transition. A poll echo (`actor → same actor`) is inert by construction. The emitted cell
 * array is copied so the presentation layer never aliases the projection it reads.
 * @param {string | null | undefined} previous_visible_actor_id primitive actor observed on the prior paint
 * @param {any} fight projected engine view carrying only presentation facts
 * @returns {{ visible_actor_id: string | null, glyph_cells: number[] }}
 */
export function glyph_tick_flare_plan(previous_visible_actor_id, fight) {
  const visible_actor_id = visible_turn_actor_id(fight)
  const turn_changed =
    previous_visible_actor_id !== undefined &&
    visible_actor_id !== null &&
    previous_visible_actor_id !== visible_actor_id
  return {
    visible_actor_id,
    glyph_cells: turn_changed ? [...(fight?.my_glyphs ?? [])] : [],
  }
}

/**
 * The ELEMENT of a cast, for its VFX/SFX flavour (F1). Resolved off the SAME on-chain spell row the range reads:
 * a heal-kind spell (guardian_mend) is the 'heal' beat; everything else reads the row's OWN top-level
 * `element` field — the seed projection carries it 1:1 from the corpus's `s.element` (the same on-chain
 * SpellTemplate.element the mint used), so it is the single source of truth for the spell's real flavour. The
 * cosmetic dungeon ids the store confirms with aren't on-chain — 'dungeon_strike' is the fire-toned orb (its own
 * store comment), everything else (a mob's physical swing, an unresolved id) reads 'neutral'. Pure; fight_cast_vfx
 * owns which elements have their own art (fire/neutral/heal full beats, earth a ground burst) — anything else
 * falls back to neutral there.
 *
 * BUG HISTORY (an air-damage spell was throwing a red fireball): this used to
 * re-derive the element by scanning `levels[0].effects` for the first entry carrying a truthy `element` field
 * (`effects.find(e => e.element)?.element`) instead of trusting the row's own `element`. A spell's PRIMARY
 * damage effect doesn't always carry an elemental tag (percent-life/life-steal/utility effects often don't),
 * so when a LATER secondary effect (a DOT, a resist-debuff) happened to carry one, `.find()` silently returned
 * THAT element instead — a wrong-but-non-neutral result the "falls back to neutral" story didn't catch. 82 of
 * 240 live spells (every damage-carrying utility/buff cast with no elemental effect at all) also silently fell
 * to 'neutral' under the old logic. The mob path was already fixed the right way (resolve_cast_element reads
 * DungeonMob.element directly, never scans effects) — this brings the player path to the same standard: read
 * the fact that's already on the row, don't re-derive it.
 * @param {string | null | undefined} spell_id
 * @returns {string} the element key (fire/water/earth/heal/neutral/…)
 */
export function element_of_spell(spell_id) {
  if (!spell_id) return 'neutral'
  const row = fight_spell(spell_id)
  if (row?.kind === 'heal') return 'heal' // [S-23] the heal beat — kind is the authoritative on-chain fact
  if (row?.element) return row.element // the on-chain SpellTemplate's own element — the single source of truth
  if (String(spell_id).startsWith('dungeon_strike')) return 'fire' // the store's fire-toned orb (cosmetic, no on-chain row)
  return 'neutral'
}

/** Selected character's escrow row, with owner-address fallback for legacy callers/fixtures. */
export function my_seat_of(dungeon, entity_id) {
  if (!dungeon || !entity_id) return null
  return (
    dungeon.escrow?.find((p) => (p.character ?? p.character_id) === entity_id) ??
    dungeon.escrow?.find((p) => p.addr === entity_id) ??
    null
  )
}

// END-TURN PRESS LAW predicate — MOVED to the core (M3 render contract: the input-arming DECISION is core law,
// @aresrpg/fight project.turn_input_armed carries the full 07-11 rationale). Re-exported here so the legacy
// import surface (FightControls + the adapter) stays stable — one home, one rule.
export { turn_input_armed } from '@aresrpg/fight/project'

// ── [p0-fight-init] BOARD LIFECYCLE DECISION — the adapter's ONE mount/teardown verdict, pure. ──────────────
// Root of the first-transition-fight dead-input family: the placement→active flip re-spawns the fight slice in
// TWO dispatches (spawn, then sync), and the reconcile that lands in the gap derives a HELD phase (desired
// ACTIVE, unmet turn data) — the old branch read that as ROAM and TORE DOWN the LIVE placement board mid-fight
// (probe-captured: "adapter teardown of a LIVE board — fight_on=true"). A HOLD is a WAIT, never an exit; and a
// build IN FLIGHT is uninterruptible (teardown defers until it settles). Decisions:
//   'build'          — a live-board phase wants a board the handle hasn't built (new fight/room).
//   'wire'           — the wanted board is built: idempotently re-assert wiring (fight_on/entities/paint).
//   'hold'           — transiently incoherent mid-fight, OR a HELD terminal on this fight's own board (#1056):
//                      do NOTHING — the terminal gate, not a reader, owns a terminal board's teardown.
//   'defer_teardown' — a genuine exit arrived while a build is in flight: run the teardown after it settles.
//   'teardown'       — a genuine exit (no board phase wanted, no transient hold): tear down now.
/**
 * #239 owner presentation ruling (final spec, 2026-07-21): the tackle floater NEVER prints a mechanic label
 * ("TACKLED") — a tackle surfaces ONLY as the numeric AP/MP losses, each its OWN house-colored float (kind
 * 'mp'/'ap' → FLOAT_COLOR.mp/ap, board_entities.js — the same mint/ice-blue the combat log's --clog-num-mp/ap
 * already use). Bare `-N` text, no unit suffix: the color IS the "which pool" signal (the established
 * convention the move beat's spent-MP floater already ships — one visual language, never a second). Either
 * leg can be independently zero (tackle_losses ceils a POOL's own fraction; a pool already at 0 costs 0 of
 * itself) — filtered out, never a bare `-0`. Pure so "numeric entries only, never a label" is unit-testable
 * without the adapter/board machinery.
 * @param {number} ap_lost @param {number} mp_lost
 * @returns {Array<{ text: string, kind: 'mp' | 'ap' }>}
 */
export function tackle_float_payloads(ap_lost, mp_lost) {
  return [
    mp_lost > 0 ? { text: `-${mp_lost}`, kind: 'mp' } : null,
    ap_lost > 0 ? { text: `-${ap_lost}`, kind: 'ap' } : null,
  ].filter(Boolean)
}

/**
 * @param {{ phase: string, desired: string, unmet: string[], has_dungeon: boolean, has_fight: boolean,
 *   built_for: string | null, build_key: string | null, building: boolean }} s
 * @returns {'build' | 'wire' | 'hold' | 'defer_teardown' | 'teardown'}
 */
export function board_lifecycle_decision({
  phase,
  desired,
  unmet,
  has_dungeon,
  has_fight,
  built_for,
  build_key,
  building,
}) {
  const BOARD_PHASES = ['PLACEMENT', 'ACTIVE', 'TERMINAL']
  const want_board = BOARD_PHASES.includes(phase) && has_dungeon && has_fight
  if (want_board) return built_for !== build_key ? 'build' : 'wire'
  // HELD short of a live-board phase (the machine WANTED placement/active but a precondition is transiently
  // unmet — the spawn→sync gap) while THIS fight's board is built or building ⇒ wait for coherence.
  // THE TERMINAL GATE OWNS TERMINAL TEARDOWN (#1056 — the [terminal-gate2] sentinel's own class, generalised).
  // A TERMINAL desire whose preconditions are unmet routes the phase machine to EXIT, and EXIT used to tear a
  // BUILT board down on the spot — ahead of the death-beat-gated present(), so the killing wave and the result
  // card were preempted and the screen went black where the victory sequence belongs. A board built for THIS
  // fight is therefore HELD on a terminal read exactly as it is on a held ACTIVE/PLACEMENT read: the reader may
  // REQUEST the exit, only the gate sequences it — and the gate's own set(cleared_session) drops the dungeon,
  // which arrives here as an ordinary (non-terminal) teardown. A client that never built a board is unaffected:
  // `same_fight` is false, so an unearned terminal still exits without ever mounting one.
  const held_for_board = (desired === 'ACTIVE' || desired === 'PLACEMENT' || desired === 'TERMINAL') && unmet.length > 0
  const same_fight = build_key !== null && built_for === build_key
  if (held_for_board && (building || same_fight)) return 'hold'
  return building ? 'defer_teardown' : 'teardown'
}
