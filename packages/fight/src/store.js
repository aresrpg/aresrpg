// fight/store.js — the ONE zustand store and the ONE write door for ALL fight state.
//
// THE ONE-REDUCER LAW (enforced by ares test fightcore gate b): `input(msg, now)` is the ONLY
// function repo-wide that writes fight state. Async results (receipt / poll / p2p / snapshot) NEVER `set()` a
// store — they dispatch an input, prediction paints first, and the versioned snapshot reconciles through the
// reducer's merge rule. Every entry is keyed `(version, event_idx)`; the log is order-independent (a re-fold of
// the sorted, deduped entries), so any interleave of {receipt, stale poll, dup poll, adopt} converges to the
// same committed state.
//
// SNAPSHOT + TAIL (the S2 base lane): a decoded Fight OBJECT read adopts wholesale as the rich `view` at its
// object `version` (at-or-below the applied floor → dropped, never regresses); ordered EVENT entries with
// version > view_version fold ON TOP as the thin overlay. One fold (`apply_action`), one merge rule, zero
// hand-rolled watermarks — this lane replaces chain_frame's floor/leapfrog machinery outright.
//
// PRESENTATION (the S2 wave lane): non-local receipt segments are paced (present.js — ~3s PER mob turn) into
// `wave` turns the renderer drains; it acks each with input({type:'presented'}). `presenting` is DERIVED
// (wave_seq > presented_seq) — never a stored latch. Projections show state at the PRESENTED floor while a wave
// drains, so committed truth never jumps the eye ahead of the beats.
//
// PLAYER MIN-TURN FLOOR: ONE 3s floor per player
// turn from the turn's own start; casts are INSTANT. THE FLOOR YIELDS TO THE DEADLINE (a turn can be lost to
// the 3s toast at 0:01 otherwise): no hold inside the last floor-width of the chain clock. The chain-side assert
// (turns.move: clock − turn_start ≥ 3000 on end_turn) stays ticketed — this client floor is the UX until then.

import { createStore } from 'zustand/vanilla'

import { auto_commit_fire_at } from './draft_budget.js'
import { auto_commit_decision, turn_commit_key, turn_submit_epoch } from './turn_commit.js'
import { DISPLACE_TELEPORT } from './fight_render_prims.js'
import { apply_action, empty_state, normalize_events, normalize_intent, seat_resolver } from './inputs.js'
import * as settle_input from './inputs.js'
import { board_state_from_fight, fight_geometry_complete } from './board_state.js'
import { masks_entries } from './present.js'
import { action_divergence } from './reconcile_action.js'
import {
  base_budget,
  carry_statuses,
  committed_state,
  foreign_replay_turns,
  last_action_of,
  merge_entries,
  recompute,
  wave_turns_of,
} from './fold.js'

// The two committed projections consumers read live in fold.js now (the ≤600-LoC split); re-export the public
// names so project.js and tools keep importing them from the store's door.
export { committed_state, presented_state, display_state } from './fold.js'

export const PLAYER_TURN_FLOOR_MS = 3000
export const MIN_ACTION_MS = 5000
// grace past a wave turn's OWN duration before the tick watchdog force-acks it — derived headroom, never a
// guessed absolute (the turn's duration is the base; this only pads renderer jitter).
export const WAVE_ACK_GRACE_MS = 6000

// PROVIDER TOKEN + SESSION IDENTITY (INC-0 — the additive mechanical floor). `refuse_reason` is the ONE gate the
// door runs before every input: a LOCAL push (my HUD intent / composite prediction) is refused unless the local
// client holds the mic (NORTH_STAR C2/C3 — "during chain_replay and idle_wait, HUD triggers NOTHING"); a chain
// or presentation-ack input crossing a fight/session boundary is dropped (B-F02/F06). A MISSING id is HELD (R5 —
// an id-less resume snapshot is claimed by the current session, never dropped). Every refusal is a logged
// non-event: the reducer records it in `state.refused` (the turn_lost idiom — the fight core is hermetic, so it
// cannot call the frontend fight_state_trace; an edge subscriber surfaces `refused`, as subscribe_turn_lost does).
const LOCAL_PUSH = new Set(['intent', 'predicted'])
const IDENTITY_SCOPED = new Set(['receipt', 'poll', 'p2p', 'snapshot', 'presented', 'placement_ghost'])
const refuse_reason = (state, msg) => {
  if (LOCAL_PUSH.has(msg.type) && state.provider !== 'local_turn')
    return { type: msg.type, reason: 'provider', provider: state.provider }
  if (IDENTITY_SCOPED.has(msg.type)) {
    if (msg.fight_id != null && state.fight_id != null && String(msg.fight_id) !== String(state.fight_id))
      return { type: msg.type, reason: 'fight_id', got: String(msg.fight_id), want: String(state.fight_id) }
    if (msg.session_generation != null && msg.session_generation !== state.session_generation)
      return {
        type: msg.type,
        reason: 'session_generation',
        got: msg.session_generation,
        want: state.session_generation,
      }
  }
  return null
}

/** Build the rich board view from a snapshot msg + the merged ctx — the ONE snapshot decode (the keystone
 *  compare and the adoption both read it, so the object is decoded identically in both). */
const snapshot_view = (ctx, msg, version) =>
  board_state_from_fight({
    fight: msg.fight,
    version,
    run: msg.run !== undefined ? msg.run : (ctx.run ?? null),
    rooms_total: msg.rooms_total ?? ctx.rooms_total ?? 0,
    mob_names: ctx.mob_names ?? {},
    mob_levels: ctx.mob_levels ?? {},
    mob_elements: ctx.mob_elements ?? {},
    creator: ctx.creator ?? null,
    offset: ctx.offset ?? undefined,
  })

const empty_fight = () => ({
  ...empty_state(null),
  entries: {},
  applied_version: -1,
  view: null, // the adopted rich board view (board_state_from_fight) — the snapshot base
  view_version: -1,
  ctx: {}, // init/context data (mob identity maps, offset, my_entity_id, beat_ctx resolvers) — NEVER hashed
  sim: null, // @aresrpg/sim FightState — the prediction seam (a shim supplies the roster)
  wave: [], // paced presentation turns [{seq, version, final, source_id, is_local, duration, beats}]
  wave_versions: [], // receipt versions that already paced a wave — a re-delivery dedupes (no 2nd visual wave, #8)
  // ④+⑦b MY PLACED TRAPS — the ONE fold-state home (ruled 07-19; the keyless read drops Fight.fx, the receipt
  // carries no trap event, so this is a durable accumulator like `wave`, carried through recompute). Records
  // [{ draft_id, cells:number[], gone }]: appended at a trap-cast dispatch, `gone`-marked when a COMMITTED
  // (receipt-proven) fighter lands on it (permanent — never regress), dropped by draft id when its cast is
  // dropped, cleared on init. engine_view projects the LIVE set (gone + presented-occupied excluded); the sim
  // door reads THAT. trap_overlay stays render-only — zero sim reads from it.
  my_traps: [],
  // MY PLACED GLYPHS — the caster's OWN placed glyph zones (the orange ground blob that STAYS). Same durable-
  // accumulator class as my_traps (the keyless read drops Fight.fx, the receipt carries no glyph event), but the
  // LIFECYCLE differs (sim/fight_traps.js is the truth): a glyph is PERSISTENT — check_glyphs ticks whoever stands
  // on it at TURN_START and never removes it — so it dies only by EXPIRY (decay_glyphs drops turns_remaining at 0).
  // Records [{ draft_id, cells:number[], turns_remaining, gone }]: appended at a glyph-cast dispatch, decremented on
  // each of MY turn-advances (the only clean client turn signal; errs toward persistence — the client has no chain
  // glyph read), dropped by shared cell on flush, cleared on init. engine_view projects the LIVE (non-gone) cells;
  // the render (voxel_fight_adapter) reads THAT projection directly — single home, no render-mirror module.
  my_glyphs: [],
  // PLACEMENT GHOSTS — a PEER's uncommitted placement pick, relayed p2p: picks aren't committed
  // pre-start, so teammates SEE where others intend to stand. Character-keyed map { [character]: { cell,
  // at } } — one ghost per character, latest pick wins. GC'd in recompute (fold.js): a committed Placed for that
  // character supersedes it forever, a stale one (GHOST_STALE_MS) expires. Cosmetic ONLY — never read by
  // legality/commit paths, excluded from canonical_state/state_hash (a lying ghost can't do anything).
  placement_ghosts: {},
  // V1 — APPEND-ONLY DEATH FLOORS { fighter_key → floor_version } (durable accumulator, same class as my_traps).
  // A fighter proven dead by an authoritative action floors here forever within the fight; `alive` DERIVES from it
  // (fold.apply_retirement), so no later higher-version read carrying a positive hp can resurrect a floor-dead
  // fighter (the resurrection root, symptom ②). Cleared per init (a new fight); never pruned by a snapshot adopt.
  retired: {},
  wave_seq: 0,
  presented_seq: 0, // renderer ack floor — `presenting` = wave_seq > presented_seq (derived, never a latch)
  pending_snapshot: null, // a fresher object read deferred while a remote wave drains (adopts at final ack)
  wave_head: null, // { seq, at } — the head wave turn (any locality) + when a tick first saw it (watchdog clock)
  turn_lost: null, // { key, reason:'missed'|'latched'|'burned', shown? } — a drafted turn that expired uncommitted; the toast edge consumes it once (no-silent-failure law)
  staged: [], // intents awaiting a PTB (txs.js)
  armed_spell_id: null, // the armed card (fight-session UI state — ONE home so every HUD surface agrees)
  hovered_spell_id: null, // the passively hovered card (D299a readout)
  hand: [], // the spell bar's name_keys (hand_update input)
  busy: false, // a fight tx is in flight (txs orchestration drives via the door)
  commit_due: false, // tick-derived level; project.commit_due is the edge-facing projection
  commit_latch: null, // executed-failure proof mirrored through the busy input (never read from another store)
  commit_attempt_epoch: null, // reducer-owned once claim; only a new playable turn/receipt produces another key
  receipt_seq: 0, // receipt feedback re-arms a same-player solo turn without weakening failure idempotency
  last_action_ms: 0, // chain floor for the next legal commit, adopted at the snapshot input door
  error: null,
  my_key: null, // which fighter I am — drives the floor + local-vs-peer pacing (never part of the parity hash)
  turn_started_at: null, // wall clock my current turn began (floor anchor); NOT re-stamped per cast
  my_turn_no: 0, // MY seat-turn counter (cast.move seat_turn twin) — bumped once per my PLAYABLE turn-start in recompute (deadline-independent); the cooldown gate's clock. Reset here per init/session.
  pending_end_turn: null, // { ready_at } while an end-turn is held under the floor
  intent_seq: 0, // monotonic event_idx for optimistic intents (keeps my clicks out of the receipt's key lane)
  settlement: settle_input.empty_settlement(), // chain-confirmed terminal + bounded attempt state
  provider: 'idle_wait', // NORTH_STAR C2: the sole push channel — 'local_turn'|'chain_replay'|'idle_wait'. DERIVED by recompute (never a stored latch); idle until the first fold.
  session_generation: 0, // bumped per init; an async input tagged with a superseded generation drops (A→B crossing guard)
  refused: null, // { type, reason, ... , at } — the last input the provider/identity gate refused (a logged non-event the edge surfaces once)
  divergence: null, // { version, at, deferred? } — the last equal-version object that disagreed with the event fold (keystone #3: the reconcile-divergence log)
})

/** THE ONE DOOR: chain inputs (snapshot/receipt/poll/p2p/terminal confirmation/outcome), local prediction,
 * presentation acks, and UI/tx signals all reduce here; nothing else writes fight state.
 * @param {(fn:(s:any)=>any)=>void} set
 * @param {()=>any} get
 */
const make_input =
  (set, get) =>
  (msg, now = Date.now()) => {
    const state = get()
    // THE PROVIDER/SESSION GATE (INC-0, NORTH_STAR C2/C3): a mismatched-provenance local push, or a chain/ack
    // input for another fight or a superseded session, is REFUSED — recorded in `state.refused` (a logged
    // non-event) and never applied. Missing id is HELD (the current session claims it). Control signals
    // (init/ctx/tick/arm/…) carry no provenance and always pass.
    const refused = refuse_reason(state, msg)
    if (refused) return set((s) => ({ ...s, refused: { ...refused, at: now } }))
    if (settle_input.is_settlement_input(msg.type))
      return set((s) => ({ ...s, settlement: settle_input.reduce_settlement(s.settlement, msg) }))
    switch (msg.type) {
      case 'init':
        set(() => ({
          ...empty_fight(),
          // A new session generation per init — an in-flight async result tagged with the prior generation
          // (a fight-A response landing after fight B opened) drops at the gate above instead of corrupting B.
          session_generation: (state.session_generation ?? 0) + 1,
          fight_id: msg.fight_id ?? null,
          my_key: msg.my_key ?? null,
          ctx: msg.ctx ?? {},
          settlement:
            msg.fight_id == null ? settle_input.pending_settlement(state.settlement) : settle_input.empty_settlement(),
        }))
        return
      case 'ctx':
        // MULTICHAR seat focus: a my_entity_id switch re-resolves my_key against the adopted view — a stale
        // stamped seat keeps the projection + transaction_character_id on the WRONG character (burned gas).
        // Unresolvable (no view yet / unknown entity) keeps the current key; adoption re-stamps as before.
        set((s) => {
          const ctx = { ...s.ctx, ...msg.ctx }
          const seat = 'my_entity_id' in (msg.ctx ?? {}) ? seat_resolver(s.view)(ctx.my_entity_id) : null
          return recompute({ ...s, ctx, my_key: seat != null ? `p${seat}` : s.my_key }, now)
        })
        return
      case 'receipt':
      case 'poll':
      case 'p2p': {
        const raw = msg.receipt?.events ?? msg.events ?? (Array.isArray(msg.receipt) ? msg.receipt : [])
        const actions = normalize_events(raw, {
          version: msg.version,
          source: msg.type,
          fight_id: msg.fight_id ?? state.fight_id,
          resolve_seat: msg.resolve_seat ?? state.ctx?.resolve_seat ?? seat_resolver(state.view),
          base_of: base_budget(state.view),
        })
        const my_actor = settle_input.actor_from_key(state.my_key)
        const ended_my_turn =
          !!my_actor &&
          actions.some(
            (action) =>
              action.kind === 'TurnEnded' &&
              !!action.is_mob === !!my_actor.is_mob &&
              Number(action.idx) === Number(my_actor.idx)
          )
        set((s) => {
          // An authoritative RECEIPT at version V is the whole statement of V — my optimistic intents at or
          // below it are predictions of a now-settled version: purge them (match→discard, mismatch→adopt).
          const entries = { ...s.entries }
          const predicted = Object.values(entries).filter(
            (entry) => entry.source === 'intent' && entry.version <= msg.version
          )
          const receipt_divergence =
            msg.type === 'receipt' ? action_divergence(predicted, actions, { version: msg.version, at: now }) : null
          if (msg.type === 'receipt')
            for (const key of Object.keys(entries))
              if (entries[key].source === 'intent' && entries[key].version <= msg.version) delete entries[key]
          // #8 — a DUPLICATE receipt (a re-delivery / reconnect catch-up at a version already presented) must not
          // append a SECOND visual wave. Track the versions that produced a wave; a re-delivered version reuses the
          // folded entries (merge_entries dedupes) but paces NO new turns. Only receipts that actually produced
          // turns are recorded (a bare local turn produces none and stays harmlessly re-runnable).
          const waved = msg.type === 'receipt' && (s.wave_versions ?? []).includes(msg.version)
          const new_turns =
            msg.type === 'receipt' && !waved ? wave_turns_of(s, raw, msg.version, msg.trap_cells ?? []) : []
          const wave = [...s.wave, ...new_turns]
          const wave_versions = new_turns.length ? [...(s.wave_versions ?? []), msg.version] : (s.wave_versions ?? [])
          return recompute(
            {
              ...s,
              commit_due: false,
              receipt_seq: msg.type === 'receipt' ? s.receipt_seq + 1 : s.receipt_seq,
              staged: ended_my_turn ? [] : s.staged,
              divergence: receipt_divergence ?? s.divergence,
              entries: merge_entries(entries, actions),
              wave,
              wave_versions,
              wave_seq: wave.length ? wave[wave.length - 1].seq : s.wave_seq,
            },
            now
          )
        })
        return
      }
      case 'snapshot': {
        // Adopt a decoded Fight OBJECT at its version (the base lane). At/below the applied floor → discarded
        // (below-floor never regresses); newer → adopt wholesale (honest resume), tail entries ≤ it pruned.
        if (msg.fight === undefined) {
          // Legacy event-shaped snapshot (S0 contract): a highest-priority event segment.
          if (msg.version <= state.applied_version) return
          const actions = normalize_events(msg.receipt ?? msg.events ?? [], {
            version: msg.version,
            source: 'snapshot',
            fight_id: msg.fight_id ?? state.fight_id,
            resolve_seat: msg.resolve_seat ?? state.ctx?.resolve_seat ?? seat_resolver(state.view),
            base_of: base_budget(state.view),
          })
          set((s) => recompute({ ...s, entries: merge_entries(s.entries, actions) }, now))
          return
        }
        const version = Number(msg.version ?? 0)
        // HOLD-NOT-DEGRADE (the adoption seam law, 07-18): a read whose BoardGeom is missing (decode_fight maps
        // an absent `board` to width/height 0) is a TORN record, not a shape. Adopting it presents the 20×19
        // fallback frame with ZERO start cells (placement clicks aimed at a frame the fight never had), and the
        // one-shot board build downstream keeps that frame for the fight's whole life even after the +250ms
        // retry heals. Never presentable: drop whole — the receipt/poll loop re-reads until the record is whole.
        if (msg.fight && !fight_geometry_complete(msg.fight)) return
        // CONVERGENCE under the hold: with NOTHING presented yet (every earlier read missed or was torn), a
        // COMPLETE read at-or-below the entry floor is still the first honest base — seed it (there is no view
        // to regress; fresher entries keep folding on top). Refusing it wedged the board at null until the next
        // tx happened to bump the object version.
        const seeds_null_view = state.view == null && msg.fight != null
        if (version <= state.applied_version && !seeds_null_view) {
          // A receipt and its confirming object read share one version. The receipt owns the event fold, while the
          // equal-version object supplies last_action_ms (not present in events) without reopening snapshot state.
          if (version === state.applied_version && msg.fight?.last_action_ms != null)
            set((s) => ({ ...s, last_action_ms: Math.max(s.last_action_ms, last_action_of(msg.fight)) }))
          // V3 (register): the equal-version wholesale re-adopt (the old "keystone #3" compare-adopt) is DELETED —
          // the monotonic gate is now ABSOLUTE (A1 inner armor · BLANKPAGE §②): vN ≤ canonical ⇒ DISCARD ENTIRELY,
          // regardless of content (this return is that discard; the SIMDRIVE no-rollback protection it also served
          // is preserved by it). The sticky-stale case the keystone patched (a receipt tail that dropped a fact the
          // equal-version object holds) is now handled at the SOURCE: RECEIPT is the one-way floor (V9), and a fact
          // a thinner ADOPT omits is HELD by V2's omission-semantics — never recovered by re-adopting a competitor
          // mid-fight (seat §3: DELETE the competitor, never arbitrate between two boards of truth).
          return
        }
        // R2 DEFERRAL — a fresher object read must not leapfrog a still-draining MASKING wave (remote turns + my
        // windowed displacement legs): adoption prunes the very entries the presented mask needs, so the fold could
        // no longer hold the eye. Stash the newest read; it adopts at the final masking ack — or the watchdog first.
        if ((state.wave ?? []).some(masks_entries)) {
          if (version > Number(state.pending_snapshot?.version ?? -1)) set((s) => ({ ...s, pending_snapshot: msg }))
          return
        }
        // SPECTATOR REPLAY — other players' actions render instantly, using the SAME sequences a local turn uses,
        // and a peer killing a mob must show during the replay, never delayed. A genuinely-
        // newer object read reveals OTHER fighters' committed moves/casts/kills the client never saw as EVENTS (the
        // poll reads the OBJECT, not the peer's tx). Rather than jump the board wholesale (peers teleport, their kill
        // lands a turn late when the next read rewrites state), foreign_replay_turns DERIVES the beats for those
        // foreign changes from the adoption diff and paces them through the SAME emission home (wave_turns_of) the
        // mob/peer receipt path uses; the wholesale view adopts AFTER the replay drains (the pending_snapshot deferral
        // home, flushed by the 'presented' ack below). PRESENTATION ONLY — committed truth is NEVER diff-built
        // (inputs.js: the client never snapshot-diffs STATE): the deferred wholesale read is the authoritative adopt.
        // Skipped on the seed (no prior view) and the deferred re-drive (`_replayed`), so a drained replay adopts.
        if (!msg._replayed && state.view != null) {
          const replay_ctx = { ...state.ctx, ...(msg.ctx ?? {}) }
          const candidate = snapshot_view(replay_ctx, msg, version)
          // LEG H — FOREIGN-REPLAY LIVE GATE: 2-account coop peers see NO replays — not player turns, not
          // mob waves. A NON-INITIATOR (joiner) resolves my_key LAZILY, and that resolution runs in the WHOLESALE
          // ADOPT below — AFTER this gate. So on the peer's FIRST foreign snapshot `state.my_key` is still null,
          // foreign_replay_turns bails (my_seat < 0), and the turn adopts INSTANTLY (gate closed). Resolve my seat
          // from the INCOMING candidate view HERE so the gate never depends on a prior adopt's timing — the
          // initiator (seat already a `p…`) is untouched; the joiner now paces the peer/mob replay like the unit path.
          const seat = state.my_key?.[0] === 'p' ? null : seat_resolver(candidate)(replay_ctx.my_entity_id)
          const draft = seat != null ? { ...state, my_key: `p${seat}` } : state
          const new_turns = foreign_replay_turns(draft, candidate, version, msg.trap_cells ?? [])
          if (new_turns.length) {
            set((s) => {
              const wave = [...s.wave, ...new_turns]
              return recompute(
                { ...s, wave, wave_seq: wave[wave.length - 1].seq, pending_snapshot: { ...msg, _replayed: true } },
                now
              )
            })
            return
          }
        }
        set((s) => {
          const ctx = { ...s.ctx, ...(msg.ctx ?? {}) }
          // V2 · A5 OMISSION-HOLD: a genuinely-newer read that does NOT model the status class must not drop a
          // receipt-floored invisibility/buff — backfill the adopted view's status rows from the prior committed
          // state so base_from_view re-derives them. A read that DOES model statuses (any array, incl []) passes
          // through untouched (carry_statuses is a no-op there).
          const view = carry_statuses(snapshot_view(ctx, msg, version), committed_state(s))
          // LEG G — FOREIGN-only intent rebase: a bug where a local turn kept getting rolled back by a
          // third-party player's foreign turn. A wholesale adopt DRIVEN BY A FOREIGN TURN (`msg._replayed`: it arrived through the
          // foreign_replay defer, so a PEER bumped the object, not me) must NOT purge my un-flushed optimistic
          // intents — they predict a version I have NOT committed yet. RE-ANCHOR them just above the adopted base so
          // recompute RE-DERIVES the predicted overlay (base + intents). Idempotent BY CONSTRUCTION: Moved/Hit/
          // Displaced fold the ABSOLUTE post-state (to_cell / remaining_hp), so re-deriving over a base that already
          // reflects an own action is a no-op — the flagged own-poll double-apply race dies structurally, not by a
          // flag. A DIRECT adopt (own-poll / seed / reconcile) still purges: my own COMMITTED action lives in the
          // adopted base, and (own-receipt path) its receipt already consumed the matching intent.
          const entries = {}
          for (const [key, entry] of Object.entries(s.entries)) {
            if (entry.version > version) entries[key] = entry
            else if (msg._replayed && entry.source === 'intent') {
              const rebased = { ...entry, version: version + 1 }
              entries[`${rebased.version}:${rebased.event_idx}`] = rebased
            }
          }
          // Adoption may be the first moment my seat is resolvable (init before the first read).
          const seat = seat_resolver(view)(ctx.my_entity_id)
          const my_key = seat != null ? `p${seat}` : s.my_key
          return recompute(
            {
              ...s,
              view,
              view_version: version,
              entries,
              ctx,
              my_key,
              commit_due: false,
              last_action_ms: Math.max(s.last_action_ms, last_action_of(msg.fight, s.last_action_ms)),
            },
            now
          )
        })
        return
      }
      case 'intent': {
        // The player MIN-TURN floor lives ONLY on end_turn, measured from turn_started_at — never per cast.
        if (msg.intent?.kind === 'end_turn' && state.turn_started_at != null) {
          const ready_at = state.turn_started_at + PLAYER_TURN_FLOOR_MS
          // THE FLOOR YIELDS TO THE DEADLINE (head doc): a park in the last floor-width could only eat the turn.
          const deadline = Number(state.turn_deadline_ms ?? 0)
          if (now < ready_at && !(deadline > 0 && deadline - now <= PLAYER_TURN_FLOOR_MS)) {
            set((s) => ({ ...s, pending_end_turn: { ready_at, intent: msg } }))
            return // held — a human never sees this (they exceed 3s naturally); a bot's instant pass is blocked
          }
        }
        const action = normalize_intent(msg.intent, {
          version: msg.version ?? Math.max(1, state.applied_version + 1),
          event_idx: msg.event_idx ?? state.intent_seq,
          actor: settle_input.actor_from_key(state.my_key),
          resolve_seat: msg.resolve_seat ?? state.ctx?.resolve_seat ?? seat_resolver(state.view),
        })
        set((s) => {
          // A local wave turn (my optimistic beats at natural durations) rides along when the caller built one —
          // the renderer plays it THIS frame (is_local: no 3s pacing) and acks it like any other turn.
          // MY OWN WALK IS WINDOWED (SNAP-THEN-RUN, reported twice in testing): a Moved intent windows its own event so
          // the DISPLAY fold (display_state) holds the pre-move cell until this walk beat presents (§7b: never an
          // insta-jump — the walk IS the render). EFFECTIVE (presented_state) still paints the destination this fold
          // so draft/legality/reach are unblocked; a cast carries NO window (B3: it routes through 'predicted').
          const beats = Array.isArray(msg.beats) ? msg.beats : []
          const walk_window = action.kind === 'Moved' ? { from_idx: action.event_idx, until_idx: action.event_idx } : {}
          const wave = beats.length
            ? [
                ...s.wave,
                {
                  seq: s.wave_seq + 1,
                  version: action.version,
                  final: false,
                  source_id: s.ctx?.my_entity_id ?? s.my_key,
                  is_local: true,
                  duration: beats.reduce((sum, b) => sum + (b.duration || 0), 0),
                  beats,
                  ...walk_window,
                },
              ]
            : s.wave
          return recompute(
            {
              ...s,
              entries: merge_entries(s.entries, [action]),
              intent_seq: s.intent_seq + 1,
              staged: action.kind === 'TurnEnded' ? [] : s.staged,
              pending_end_turn: null,
              // A cast stays armed while the targetable click is only a verdict; clear it atomically once the
              // normalized local Cast is accepted into the reducer log. Other intents never touch the selection.
              armed_spell_id: action.kind === 'Cast' ? null : s.armed_spell_id,
              wave,
              wave_seq: wave.length ? wave[wave.length - 1].seq : s.wave_seq,
            },
            now
          )
        })
        return
      }
      case 'predicted': {
        // COMPOSITE PREDICTION (register #22 dissolved at the door): a whole optimistic cast result — its Cast
        // and every Displaced/Hit/status effect — folds in ONE set(), so no subscriber can ever observe a Cast
        // without its effects. The rows are PREDICTION (source 'intent'): purged by the confirming receipt like
        // any optimistic entry, NEVER raising the confirmed floor (recompute excludes intents). `intent_id` tags
        // the batch so a reverted tx rolls the whole cast back atomically; `basis_version` is the floor it predicts.
        const base_version = Math.max(1, Number(msg.basis_version ?? state.applied_version + 1))
        const actor = settle_input.actor_from_key(state.my_key)
        const resolve_seat = msg.resolve_seat ?? state.ctx?.resolve_seat ?? seat_resolver(state.view)
        const actions = (msg.actions ?? []).map((raw, i) => {
          const action = normalize_intent(raw, {
            version: raw.version ?? base_version,
            event_idx: raw.event_idx ?? state.intent_seq + i,
            actor,
            resolve_seat,
          })
          return msg.intent_id != null ? { ...action, intent_id: msg.intent_id } : action
        })
        set((s) => {
          const beats = Array.isArray(msg.beats) ? msg.beats : []
          // ③ PREDICTED-DISPLACEMENT WINDOW (ruled 07-19, option a): a predicted `Displaced` is the walk-window
          // class — a mover whose motion beat is in flight. Window its entries so display_state HOLDS each victim
          // at the pre-push cell until the slide beat presents (the rig animates FROM there, never a teleport
          // ahead of the slide); the presented/effective fold still sees the destination this frame (draft
          // legality unblocked). A cast with no Displaced carries NO window — B3, its effects paint immediately.
          // A TELEPORT is INSTANT by design (the local sim NEVER needs the chain for such an effect): its
          // Displaced is tagged effect_kind K_TELEPORT and EXCLUDED from the window — the caster jumps to the landing
          // cell THIS frame in DISPLAY too (the render blinks, so there is no slide to hold for).
          const displaced_idxs = actions
            .filter((a) => a.kind === 'Displaced' && a.effect_kind !== DISPLACE_TELEPORT)
            .map((a) => a.event_idx)
          const window = displaced_idxs.length
            ? { from_idx: Math.min(...displaced_idxs), until_idx: Math.max(...displaced_idxs) }
            : {}
          const wave = beats.length
            ? [
                ...s.wave,
                {
                  seq: s.wave_seq + 1,
                  version: base_version,
                  final: false,
                  source_id: s.ctx?.my_entity_id ?? s.my_key,
                  is_local: true,
                  duration: beats.reduce((sum, b) => sum + (b.duration || 0), 0),
                  beats,
                  ...window,
                },
              ]
            : s.wave
          // ④+⑦b+① fold the trap THIS cast places into the durable `my_traps` home (keyed by the cast batch's
          // draft id) — a same-turn push then force-stops on it through the sim door AND detonates its payload.
          // Each place_traps entry is an encoded cell OR {cell, payload} (predict_cast.placed_traps): the record
          // stores flat cells (the projection/drop-path read them raw) + the trap's shared detonation payload.
          // Recorded at dispatch so the force-stop is live THIS frame; the flush-drop path removes it if uncommitted.
          const place_traps = Array.isArray(msg.place_traps) ? msg.place_traps : []
          const trap_cells = place_traps.map((e) => (e != null && typeof e === 'object' ? e.cell : e))
          const trap_payload =
            place_traps.map((e) => (e != null && typeof e === 'object' ? e.payload : null)).find((p) => p?.length) ?? []
          const my_traps = trap_cells.length
            ? [
                ...s.my_traps,
                // RETIRES only on a receipt-proven ENTER (fold.js `detonated` — a committed fighter on the cell);
                // a version bump is NOT a firing, so no placed_view_version anchor (the `superseded` proxy is gone).
                // B (register): `basis_version` = the floor this cast predicts. Once an authoritative receipt raises
                // the applied floor to/past it, the trap is COMMITTED chain truth and drop_traps can no longer evict
                // it (version-gated input, composite §1) — the boundary-rollback race becomes structurally inert.
                { draft_id: msg.intent_id ?? null, basis_version: base_version, cells: trap_cells, gone: false, payload: trap_payload },
              ]
            : s.my_traps
          // fold any glyph THIS cast places into the durable my_glyphs home (predict_cast.placed_glyphs): each entry
          // is { cells:number[], turns } — the whole AoE zone as one record so it expires + renders as one unit.
          // Recorded at dispatch so the orange zone shows THIS frame; the flush-drop path removes it if uncommitted.
          const place_glyphs = Array.isArray(msg.place_glyphs) ? msg.place_glyphs : []
          const my_glyphs = place_glyphs.length
            ? [
                ...s.my_glyphs,
                ...place_glyphs.map((g) => ({
                  draft_id: msg.intent_id ?? null,
                  cells: Array.isArray(g?.cells) ? g.cells : [],
                  turns_remaining: Number(g?.turns ?? g?.turns_remaining ?? 1),
                  gone: false,
                })),
              ]
            : s.my_glyphs
          return recompute(
            {
              ...s,
              entries: merge_entries(s.entries, actions),
              intent_seq: s.intent_seq + actions.length,
              pending_end_turn: null,
              armed_spell_id: actions.some((a) => a.kind === 'Cast') ? null : s.armed_spell_id,
              wave,
              wave_seq: wave.length ? wave[wave.length - 1].seq : s.wave_seq,
              my_traps,
              my_glyphs,
            },
            now
          )
        })
        return
      }
      case 'drop_traps': {
        // The flush-drop / turn-boundary rollback: a trap-cast that never reaches the chain takes its optimistic
        // `my_traps` record back (by draft id when known, else by any shared cell — the flush knows the cells).
        set((s) => {
          const ids = new Set(msg.draft_ids ?? [])
          const cells = new Set(msg.cells ?? [])
          // B (register · composite §1): drop_traps is a VERSION-GATED input. A COMMITTED trap — its cast's
          // basis_version at/below the applied floor (an authoritative receipt has superseded it) — is chain truth,
          // structurally immune to ANY stale reset whoever fires it (the turn-boundary rollback was the last
          // un-enumerated writer, same species as V3). Only a still-optimistic (uncommitted) trap rolls back.
          const committed = (t) => t.basis_version != null && Number(t.basis_version) <= s.applied_version
          const my_traps = (s.my_traps ?? []).filter(
            (t) => committed(t) || !(ids.has(t.draft_id) || t.cells.some((c) => cells.has(c)))
          )
          return recompute({ ...s, my_traps }, now)
        })
        return
      }
      case 'drop_glyphs': {
        // The flush-drop / turn-boundary rollback: a glyph-cast that never reaches the chain takes its optimistic
        // my_glyphs record back (by draft id when known, else by any shared cell — the flush knows the zone cells).
        set((s) => {
          const ids = new Set(msg.draft_ids ?? [])
          const cells = new Set(msg.cells ?? [])
          const my_glyphs = (s.my_glyphs ?? []).filter(
            (g) => !(ids.has(g.draft_id) || g.cells.some((c) => cells.has(c)))
          )
          return recompute({ ...s, my_glyphs }, now)
        })
        return
      }
      case 'placement_ghost': {
        // A peer's LOCAL pick, relayed p2p (voxel_fight_adapter's placement click handler broadcasts its own
        // exactly as it dispatches the local optimistic 'Placed' intent). Own-seat excluded — never render my
        // OWN click as a hint of itself (I already see my real pick). Identity-scoped above: a mismatched
        // fight_id/session is refused before reaching here. recompute() owns the GC (commit-supersede + stale
        // expiry, fold.js) — this door only upserts the latest pick per character.
        if (!msg.character || String(msg.character) === String(state.ctx?.my_entity_id ?? '')) return
        set((s) =>
          recompute(
            {
              ...s,
              placement_ghosts: { ...s.placement_ghosts, [String(msg.character)]: { cell: msg.cell, at: now } },
            },
            now
          )
        )
        return
      }
      case 'rollback': {
        // A reverted/failed tx (txs .catch — B-F03) removes the predicted entries and recomputes to committed
        // truth. Prediction is not transport truth: this is the ONLY way a bad prediction leaves — no fabricated
        // optimistic version survives its own tx failing (the sticky predicted HP/cell/AP class). Targeted by
        // `intent_id` (a composite cast batch) or `predicts` {version, event_idx}; default = the whole optimistic
        // turn. ONLY intent rows are ever removed; an authoritative receipt/snapshot fact is never rolled back.
        set((s) => {
          const drop = (e) => {
            if (e.source !== 'intent') return false
            if (msg.intent_id != null) return e.intent_id === msg.intent_id
            if (msg.predicts) return e.version === msg.predicts.version && e.event_idx === msg.predicts.event_idx
            return true
          }
          const entries = Object.fromEntries(Object.entries(s.entries).filter(([, e]) => !drop(e)))
          return recompute({ ...s, entries }, now)
        })
        return
      }
      case 'presented': {
        const seq = msg.seq ?? state.wave_seq
        set((s) =>
          recompute(
            {
              ...s,
              commit_due: false,
              presented_seq: Math.max(s.presented_seq, seq),
              wave: s.wave.filter((t) => t.seq > seq),
            },
            now
          )
        )
        // the drain emptied the masking wave — the deferred object read (if any) adopts NOW, through the same
        // door it always used (the 'flush' self-drive precedent at the end of this switch).
        const after = get()
        if (after.pending_snapshot && !(after.wave ?? []).some(masks_entries)) {
          const pending = after.pending_snapshot
          set((s) => ({ ...s, pending_snapshot: null }))
          get().input(pending, now)
        }
        return
      }
      case 'arm':
        set((s) => ({ ...s, armed_spell_id: s.armed_spell_id === msg.spell_id ? null : (msg.spell_id ?? null) }))
        return
      case 'board_click':
        // SPELL DESELECT: clicking any non-targetable cell with a spell armed deselects
        // it — armed ∧ ¬targetable ⇒ DISARM — the ONE deselect rule, in the core. `cell` (null = off-board)
        // rides for provenance; `targetable` is the edge's castable verdict (the set needs the frontend seed
        // row — an edge input by the same doctrine as move_wash's `targeting`). Emits nothing, stages nothing:
        // drafting a cast on a targetable click stays the adapter's.
        if (state.armed_spell_id && !msg.targetable) set((s) => ({ ...s, armed_spell_id: null }))
        return
      case 'hover_spell':
        set((s) => ({ ...s, hovered_spell_id: msg.spell_id ?? null }))
        return
      case 'hand_update':
        set((s) => ({ ...s, hand: msg.hand ?? [] }))
        return
      case 'busy':
        set((s) => ({
          ...s,
          busy: !!msg.value,
          commit_latch: msg.latch === undefined ? s.commit_latch : msg.latch,
          commit_attempt_epoch: msg.attempt_epoch === undefined ? s.commit_attempt_epoch : (msg.attempt_epoch ?? null),
          ...(msg.value ? { error: null, commit_due: false } : {}),
        }))
        return
      case 'error':
        set((s) => ({ ...s, error: msg.message ?? null }))
        return
      case 'tick': {
        const deadline = Number(state.turn_deadline_ms ?? 0)
        const deadline_fresh = state.turn_deadline_fresh === true && deadline > 0
        const tick_last_action = Number(msg.last_action_ms ?? state.last_action_ms ?? 0)
        const last_action_ms = Math.max(
          state.last_action_ms,
          Number.isFinite(tick_last_action) ? tick_last_action : state.last_action_ms
        )
        const draft_count = Number(msg.draft_count ?? state.staged.length)
        const commit_latch = msg.latch === undefined ? state.commit_latch : msg.latch
        const submit_epoch = turn_submit_epoch(state)
        const turn_key = turn_commit_key({
          fight_id: state.fight_id,
          entity_id: state.ctx?.my_entity_id ?? state.my_key,
          deadline_ms: deadline,
        })
        const decision = auto_commit_decision({
          enabled:
            msg.enabled !== false &&
            deadline_fresh &&
            state.active != null &&
            state.active === state.my_key &&
            state.winner === -1 &&
            state.phase === 'active',
          busy: state.busy,
          now_ms: now,
          deadline_ms: deadline,
          latch: commit_latch,
          turn_key,
        })
        // Absolute chain deadline, never receipt/UI re-anchored. The 5s submit margin survives r8's measured 2.6s
        // latency; auto_commit_fire_at clamps a short admin dial to actions.move::assert_min_turn's legal boundary.
        // The distinct last_action_ms pacing floor remains on the mid-turn KILL path alone (kill_due below).
        const deadline_due = deadline_fresh && now >= auto_commit_fire_at(deadline, state.view?.turn_ms)
        const mobs = Object.values(committed_state(state).fighters ?? {}).filter((fighter) => fighter.is_mob)
        const kill_due =
          deadline_fresh &&
          mobs.length > 0 &&
          mobs.every((fighter) => !fighter.alive) &&
          state.turn_started_at != null &&
          now >= state.turn_started_at + PLAYER_TURN_FLOOR_MS &&
          now >= last_action_ms + MIN_ACTION_MS
        // TURN-LOST output (no-silent-failure law — the old auto_flush 'missed' toast, rebuilt as a reducer
        // output): a DRAFTED turn that expires uncommitted surfaces exactly once per turn_key. 'latched' (an
        // executed on-chain failure — gas spent, never retried) is lost the moment the latch lands; 'missed'
        // (busy past the deadline) and 'burned' (submit epoch consumed, no receipt ever folded) are lost only
        // once the chain deadline truly passes. The toast edge (txs.subscribe_turn_lost) consumes it.
        const epoch_burned = submit_epoch != null && submit_epoch === state.commit_attempt_epoch && !state.busy
        const expired = deadline_fresh && now >= deadline
        const lost_reason =
          draft_count > 0 && state.turn_lost?.key !== turn_key
            ? decision === 'latched'
              ? 'latched'
              : expired && decision === 'missed'
                ? 'missed'
                : expired && decision === 'fire' && epoch_burned
                  ? 'burned'
                  : null
            : null
        set((s) => ({
          ...s,
          commit_due:
            submit_epoch != null &&
            submit_epoch !== state.commit_attempt_epoch &&
            decision === 'fire' &&
            (deadline_due || kill_due),
          commit_latch,
          last_action_ms,
          turn_lost: lost_reason ? { key: turn_key, reason: lost_reason } : s.turn_lost,
        }))
        // WAVE WATCHDOG (the old MOB_WAVE_CAP_MS force-drain, rebuilt): the TRUE head turn — LOCAL included,
        // since unacked death beats hold a kill's despawn (project.death_presenting_ids) — overstaying its
        // duration + grace (renderer wedged/unmounted) is force-acked through the same door: no unbounded holds.
        const head = (get().wave ?? [])[0] ?? null
        set((s) => ({
          ...s,
          wave_head: head ? (s.wave_head?.seq === head.seq ? s.wave_head : { seq: head.seq, at: now }) : null,
        }))
        const watch = get().wave_head
        if (head && watch && watch.seq === head.seq && now > watch.at + (head.duration || 0) + WAVE_ACK_GRACE_MS)
          get().input({ type: 'presented', seq: head.seq }, now)
        return
      }
      case 'turn_lost_shown': // the toast edge consumed this loss — reducer-owned idempotency (remount-safe)
        set((s) =>
          s.turn_lost && s.turn_lost.key === msg.key ? { ...s, turn_lost: { ...s.turn_lost, shown: true } } : s
        )
        return
      case 'divergence_shown':
        set((s) =>
          s.divergence?.kind === 'action' && s.divergence.version === msg.version && s.divergence.action === msg.action
            ? { ...s, divergence: { ...s.divergence, shown: true } }
            : s
        )
        return
      case 'flush': {
        const pending = state.pending_end_turn
        if (!pending || now < pending.ready_at) return
        get().input(pending.intent, now) // re-drive the held end-turn now that the floor has passed
        return
      }
      case 'stage': // pre-commit draft (clicked but not yet in a PTB) — draft, NOT committed fight state
        set((s) => ({ ...s, staged: [...s.staged, msg.intent] }))
        return
      case 'clear_staged':
        set((s) => ({ ...s, staged: [], commit_due: false }))
        return
      default:
        return
    }
  }

export const create_fight_store = () =>
  createStore((set, get) => ({
    ...empty_fight(),
    input: make_input(set, get),
    // A raw fold helper for tests/tools that want a committed state from a log without the store plumbing.
    fold: (log) => log.reduce(apply_action, empty_state(get().fight_id)),
  }))

/** The app-wide singleton — VANILLA zustand (node-clean); the React hook (`use_fight`) is a frontend adapter. */
export const fight_store = create_fight_store()
