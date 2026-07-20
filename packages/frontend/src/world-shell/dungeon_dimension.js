// board #47 → D224 — the DUNGEON DIMENSION, voxel edition: the room ROSTER publisher + the ENGAGE action.
// The roam-era PLANE slice (terrain override, bounded box) is DELETED — the ENG-17 cave room replaced the
// plane wholesale and cave_session owns that transition; nothing read `plane` anymore (dead code = defect).
//
// D224 ROOT: this module's wire() ran at import — and its only static importers (roam + the old HUD) were
// deleted, so the module silently STOPPED LOADING: reconcile never subscribed, the roster never published,
// engage lost its caller. Both halves of the "empty cave" bug were dead. cave_session static-imports
// this module now (the voxel consumer), which revives wire() exactly as designed.
//
// THE MOB CLUSTER is OPEN/ROOM_CLEARED-only (pre-fight — clicking it engages); it tears down the instant
// the fight goes ACTIVE (the tactical board renders the mobs from then on), and ROOM_CLEARED publishes the
// NEXT room's roster (clicking it IS "next room"). REUSE: the roster is REPLAYED through the
// same group-spawn wire event mob_groups.js already folds into state.visible_mobs_group — cave_mobs.js is
// the voxel renderer of that Map (the wire `position` is vestigial: the cave anchors the pack at its own
// mob_spawn).
//
// ENGAGE = START (P0 #6 + mob-click one-toast): there is NO join-window modal.
// Clicking the mob pack (cave_mobs → action/dungeon_engage) fires the room start DIRECTLY — the LEADER's client
// runs start_room/add_room_mob*/finish_room via dungeon_store.start_when_ready, wrapped in ONE aggregate toast
// (as_one_toast) so the click never spams one toast per inner tx (a spam bug once let through). Chain-authorship
// law: start_room stays the on-chain truth, fired by the creator; members just poll the flip to ACTIVE.
//
// D280 — the FIGHT-START CEREMONY (reverses the earlier "no fight-sword marker" call): the mob-pack click plants
// a beacon sword at the pack's spot (cave_session renders it — it owns the engine + anchor) and OPTIMISTICALLY
// clears the pack, so the sword visibly REPLACES the mobs while the start txs run. The beacon is the tx-wait
// marker; it yields the instant the board mounts (status → ACTIVE). If the start ABORTS (the tx throws, or the
// flip never lands within the timeout) the sword despawns and the pack is restored. See start_fight_ceremony.

import { create } from 'zustand'

import { context } from '../game/store.js'
import { use_auth } from '../auth'
import i18n from '../i18n'
import { game_log } from '../core/log.js'

import { use_dungeon } from './dungeon_store.js'
import { as_one_toast } from './dungeon_actions.js'
import {
  DUNGEON_CEREMONY_FINISHED,
  DUNGEON_CEREMONY_STARTED,
  dungeon_dimension_reduce,
} from './dungeon_dimension_reducer.js'

const STATUS_OPEN = 0
const STATUS_ACTIVE = 1 // the fight board mounts — the beacon sword yields to it
const STATUS_ROOM_CLEARED = 2
const CEREMONY_TIMEOUT_MS = 20000 // start never flips ACTIVE → abort the ceremony, restore the pack

/** Group id derived from a dungeon id — stable so spawn is idempotent + despawn targets the right entry. */
const group_id_of = (dungeon_id) => `dgn::${dungeon_id}::group`

/** Build the wire mob `Entity[]` for the pre-fight room `cluster_room` from its template roster (MobTemplate
 * ids). get_mob_model (data/mobs.js) resolves the real creature GLB off Entity.NAME (normalized to a catalog
 * key) — MobTemplate carries no visual field, so `variant` (the raw template_id) can never match a catalog
 * entry; the roster's mob_names already carries the on-chain name (same source the fight board reads), which
 * is all get_mob_model needs (catalog-parity: never invent a mob — these are the dungeon's own template).
 * `group_key` (dungeon_id#room) keeps each room's member ids distinct so the reconcile diffs cleanly. */
function room_entities(group_key, cluster_room) {
  const { rooms } = use_dungeon.getState()
  const mob_ids = rooms?.[cluster_room] ?? []
  return mob_ids.map((template_id, i) => ({
    id: `${group_key}::${i}`,
    variant: template_id, // legacy-id compat only — never a chain mob's real lookup key (see get_mob_model)
    name: use_dungeon.getState().mob_names?.[template_id] || 'Mob', // D136: same identity source as the fight board; THE key get_mob_model resolves on
    type: 'mob',
    level: use_dungeon.getState().mob_levels?.[template_id] ?? 1, // D227 — the plate's LV line (chain truth)
    size: 1,
  }))
}

export const use_dungeon_dimension = create((set, get) => ({
  /** @type {string | null} the dungeon id whose room mob cluster is currently spawned (OPEN pre-fight only) */
  spawned_for: null,

  /** @type {symbol | null} version of the live fight-start ceremony; rejects late/duplicate async results. */
  ceremony_id: null,

  /** The single write door for timer/listener results; every state transition is owned by the pure reducer. */
  input(message) {
    let accepted = false
    set((state) => {
      const next = dungeon_dimension_reduce(state, message)
      accepted = next !== state
      return next
    })
    return accepted
  },

  /**
   * Reconcile the mob cluster against the live dungeon session. Only meaningful while the dungeon is OPEN
   * (pre-fight — clicking the pack is the engage) or ROOM_CLEARED (D37b — the board unmounted, the NEXT
   * room's pack is clickable to advance). The instant the fight starts (ACTIVE) the tactical board renders
   * the mobs, so the pack is torn down. Keyed on the real on-chain status (needs the live `dungeon`).
   * Idempotent + cheap (guarded by spawned_for), safe on every dungeon_store change (see subscribe).
   */
  reconcile() {
    const { dungeon, dungeon_id, in_session } = use_dungeon.getState()
    // SESSION = optimistic entry flag OR a live dungeon object still present (covers resume + the terminal card
    // window, where in_session stays set until the player closes out via reset/burn).
    const session = in_session || !!dungeon_id
    const status = dungeon?.status
    const roam_phase = session && (status === STATUS_OPEN || status === STATUS_ROOM_CLEARED)
    // Which room's mobs to preview: OPEN = the current (room 0) roster; ROOM_CLEARED = the NEXT room's roster.
    const cluster_room = status === STATUS_ROOM_CLEARED ? (dungeon?.room_index ?? 0) + 1 : (dungeon?.room_index ?? 0)
    // Room-scoped cluster key so ACTIVE→ROOM_CLEARED (same dungeon_id, next room) is a real diff → respawns.
    const cluster_key = roam_phase ? `${dungeon_id}#${cluster_room}` : null
    const { spawned_for } = get()

    if (roam_phase && spawned_for !== cluster_key) {
      if (spawned_for) despawn(spawned_for)
      spawn(cluster_key, cluster_room)
      set({ spawned_for: cluster_key })
    } else if (!roam_phase && spawned_for) {
      despawn(spawned_for)
      set({ spawned_for: null })
    }
  },

  /** @type {boolean} single-flight guard so a double mob-click never stacks two aggregate start toasts. */
  _engaging: false,

  /**
   * ENGAGE = START (P0 #6 + mob-click one-toast fix): a cluster click (roam → action/dungeon_engage)
   * starts the room directly. No tx of our own — only the LEADER (dungeon.creator) fires the on-chain
   * start_room / add_room_mob (per mob) / finish_room via dungeon_store.start_when_ready so the party isn't
   * surprised by an early start; members just poll the flip to ACTIVE (dungeon_store handles it). No-op if not OPEN.
   *
   * ONE TOAST: start_when_ready is a SEQUENCE of standalone txs (Random-PTB rule — each its own
   * tx); wrap the whole thing in ONE aggregate as_one_toast (matching the console "Start" button in
   * DungeonsModal) so the mob-click shows a single pending→confirmed toast, never one per inner tx (the toast
   * spam that once got through). The player keeps standing in the cave while these run — no loading gate.
   * as_one_toast is the UI-trigger wrapper (this engage IS the mob-click trigger).
   */
  async engage() {
    const { dungeon, dungeon_id } = use_dungeon.getState()
    const status = dungeon?.status
    // OPEN → start room 0; ROOM_CLEARED → advance to the next room (D37b — clicking the next cluster IS "Next
    // Room", no modal). Both run their tx sequence under ONE aggregate toast.
    if (!dungeon_id || (status !== STATUS_OPEN && status !== STATUS_ROOM_CLEARED)) return
    const me = use_auth.getState().address
    if (!dungeon || !me || dungeon.creator !== me) return // only the leader fires the start (party isn't surprised)
    if (get()._engaging) return
    set({ _engaging: true })
    // D3 FIGHT-START PARITY (dungeon fights start EXACTLY like open-world fights — press → rotating camera
    // FIRST, tx in the background): fire the SAME pre-tx beat world_spawns fires, so ONE flow (fight_entry) drives
    // both entries. fight_entry.on_engage resolves the cave board frame itself (get_cave_anchor) and skips the
    // sword — the D280 ceremony below plants the cave's own beacon (never a second sword). No anchor is passed:
    // the world path needs one, the cave resolves its frame from the mounted board.
    context.events.emit('fight_entry/engage', {})
    // D280 — plant the beacon sword + optimistically clear the pack the instant the click lands, BEFORE the txs
    // run (the sword is the tx-wait marker). It self-resolves on the ACTIVE flip (board mounts) or a timeout.
    start_fight_ceremony(get().spawned_for)
    try {
      // D107 tx-provenance: this engage IS the mob-cluster CLICK (the listener already asserted payload.user),
      // so thread the user gesture through to the store's start action — the ONLY legal room-start trigger.
      const start = () =>
        status === STATUS_OPEN
          ? use_dungeon.getState().start_when_ready({ user: true })
          : use_dungeon.getState().start_next_room({ user: true })
      await as_one_toast(i18n.t('dungeons.action_start_room_all'), start)
      // SUCCESS: leave the beacon planted — it yields to the board when the status flips ACTIVE (the ceremony's
      // own status watch), so there is no gap between the sword lifting and the board painting.
      // start_when_ready / start_next_room SWALLOW their own tx errors (set store.error, never throw), so a FAILED
      // start surfaces here as "no fight was minted": roll the beat back FAST (parity with the world path's
      // fight_entry/abort — never the 20s belt) so the camera never hangs in iso view on a failed start.
      if (!use_dungeon.getState().fight_id) {
        abort_fight_ceremony()
        context.events.emit('fight_entry/abort')
      }
    } catch (error) {
      abort_fight_ceremony() // the start threw → drop the sword + bring the pack back (the toast showed the error)
      context.events.emit('fight_entry/abort') // + release the fight-entry camera (never a stuck iso view)
      throw error
    } finally {
      set({ _engaging: false })
    }
  },
}))

// ── scene bridge (dungeon room → the wire event mob_groups.js's reconciler already folds) ────────────────

/** Spawn a pre-fight room's mob cluster by REPLAYING the group-spawn event mob_groups.js folds (see the module
 * doc). The pack itself is the engage target; the click then plants the D280 beacon (start_fight_ceremony) and
 * optimistically despawns this cluster until the fight is ACTIVE (or restores it on abort). `group_key` = dungeon_id#room.
 * The wire `position` is vestigial (roam anchored the cluster on it; cave_mobs anchors at the room's own
 * mob_spawn and ignores it) — zeroed, kept only because the wire shape requires it. */
function spawn(group_key, cluster_room) {
  const entities = room_entities(group_key, cluster_room)
  context.dispatch('packet/entityGroupSpawn', { id: group_id_of(group_key), position: { x: 0, y: 0, z: 0 }, entities })
}

/** Tear the cluster back out of the scene (fight started, or dungeon abandoned/claimed). */
function despawn(group_key) {
  context.dispatch('packet/entityGroupsDespawn', { ids: [group_id_of(group_key)] })
}

// ── D280 fight-start ceremony (the tx-wait beacon sword) ─────────────────────────────────────────────────
// The sword itself is rendered by cave_session (it owns the engine + the pack anchor); we drive it over the
// shared bus and own the pack's optimistic despawn/restore. Single-flight: one beacon at a time.
/** @type {(() => void) | null} the live ceremony's abort handle (null when none runs). */
let _ceremony_abort = null

/**
 * Plant the beacon + optimistically clear the pack, then wait for the outcome. `restore_key` = the pack cluster
 * key currently shown (spawned_for) — kept so an abort can bring exactly that pack back. Resolves silently when
 * the status flips ACTIVE (board mounts → the sword yields, pack stays gone). Aborts (drop sword + restore pack)
 * on the timeout, or when engage()'s tx throws (via abort_fight_ceremony).
 */
function start_fight_ceremony(restore_key) {
  if (_ceremony_abort) return // a beacon is already planted for this click burst
  const ceremony_id = Symbol('dungeon fight ceremony')
  if (
    !use_dungeon_dimension.getState().input({
      type: DUNGEON_CEREMONY_STARTED,
      ceremony_id,
    })
  )
    return
  context.events.emit('fight_ceremony/plant') // cave_session plants the sword at the pack anchor
  if (restore_key) despawn(restore_key) // optimistic: the pack vanishes, the sword lands in its place
  let settled = false
  const finish = (/** @type {boolean} */ restore) => {
    if (settled) return
    settled = true
    clearTimeout(timer)
    unsub()
    _ceremony_abort = null
    const accepted = use_dungeon_dimension.getState().input({
      type: DUNGEON_CEREMONY_FINISHED,
      ceremony_id,
      restore,
      restore_key,
    })
    if (!accepted) return
    context.events.emit('fight_ceremony/despawn') // the sword lifts away
    if (restore) {
      // ABORT: the pack was optimistically hidden but spawned_for still names it — null it and let reconcile
      // respawn against the live (still-OPEN) state, the single source of truth for the roster.
      use_dungeon_dimension.getState().reconcile()
    }
  }
  const unsub = use_dungeon.subscribe(() => {
    if (use_dungeon.getState().dungeon?.status === STATUS_ACTIVE) finish(false) // board mounts → the sword yields
  })
  const timer = setTimeout(() => finish(true), CEREMONY_TIMEOUT_MS) // never flipped → restore the pack
  _ceremony_abort = () => finish(true)
}

/** Drop the beacon + restore the pack now (the start tx threw). No-op if the ceremony already settled. */
function abort_fight_ceremony() {
  _ceremony_abort?.()
}

let _wired = false

/** Wire the dimension into the app ONCE (idempotent): react to the mob-pack click + keep the cluster synced
 * with the live dungeon lifecycle. Runs at module load — cave_session static-imports this module (D224: the
 * old importers, roam + the pre-voxel HUD, were deleted and the module silently stopped loading). */
function wire() {
  // D58c HMR-STACKING FIX: `_wired` was MODULE-scoped — every vite HMR of this module (or its import chain)
  // re-executed with a fresh `_wired=false` and re-registered onto the SHARED events bus, while the OLD
  // listener (closing over the OLD store instance with its OWN `_engaging` guard) stayed on. One click could
  // then fan out into N racing start sequences — a phantom "Starting the room" class. The guard now
  // lives ON THE SHARED BUS OBJECT, which survives HMR, so re-execution is a no-op.
  const bus = /** @type {any} */ (context.events)
  if (_wired || bus.__dungeon_dimension_wired) return
  _wired = true
  bus.__dungeon_dimension_wired = true
  // roam.js dispatches this when the mob cluster is clicked while a dungeon is open — engage = start the room.
  // TX-PROVENANCE LAW: a room-start tx fires ONLY from an explicit user gesture — the
  // dispatch must carry `user: true` (the roam click sets it). Anything else (replay, boot artifact, stray
  // dispatch) logs LOUDLY and no-ops; resume paths READ state and route, they never submit.
  context.events.on('action/dungeon_engage', (/** @type {any} */ payload) => {
    if (!payload?.user) {
      game_log('dungeon', 'BLOCKED a non-user dungeon_engage dispatch (tx-provenance law)', payload)
      return
    }
    use_dungeon_dimension.getState().engage()
  })
  // keep the plane + cluster reconciled with the on-chain dungeon lifecycle (spawn on OPEN, tear down on start).
  use_dungeon.subscribe(() => use_dungeon_dimension.getState().reconcile())
}

wire()
