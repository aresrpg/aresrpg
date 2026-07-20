// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Ambient music — two preloaded looping beds with exactly ONE active HTMLAudioElement at a time. The calm
// roam bed and tenser fight bed are served from Walrus (the `music` quilt, T-59). Transitions pause the prior
// stream before playing the next; duck + master volume share one ramp. Element construction is gesture-deferred,
// so importing this module is side-effect-free and safe at boot.
//
// OFF BY DEFAULT: the module boots with no zone. set_zone_music/stop_zone_music own the followed biome;
// start/stop/toggle layer a persisted mute preference over it. set_combat switches the armed pair.
//
// T-81 uploaded the 9 owned bed pairs (arctic/desert/glacier/grassland/scorched/swamp/taiga/temperate/
// tropical) — TRACK_NAMES is the single list. MUSIC LAW: every biome — the 9 exact
// matches, the 17-entry terrain registry, any on-chain per-world biome, all of them — hash-assigns onto
// one pair (track_for_biome); there is no curated per-biome row to maintain and no silence fallback. Widen
// the pool later by uploading a new `<name>.mp3` + `<name>_battle.mp3` pair and adding the name below.

import { walrus_asset_url } from '@aresrpg/sdk/jobs'

import { ASSETS_URL } from '../../../env'
import { game_log } from '../../../core/log.js'
import { create_music_self_heal } from './music_self_heal.js'

// ---------------------------------------------------------------------------------------------
// tuning
// ---------------------------------------------------------------------------------------------

const DEFAULT_VOLUME = 0.35 // master, 0..1 — subtle by default, never harsh
const FADE = 1.4 // seconds for visibility ducking and one-stream track handoff ramps

/**
 * The owned non-battle track names — the ONLY music we ship (the prior YouTube-ripped
 * lobby placeholder is deleted outright, never replaced). Each name has a `<name>.mp3` (world/biome roam
 * loop) + `<name>_battle.mp3` (fight loop) pair on the Walrus `music` quilt. ASSETS_URL is the host-free
 * /assets base, so a value is `/assets/music/<name>.mp3` — walrus_music_url resolves it to the aggregator
 * (curl-verified 200). NOT local imports — these are 2MB+ binaries and the music/ source dir is gitignored.
 * @type {readonly string[]}
 */
export const TRACK_NAMES = [
  'arctic',
  'desert',
  'glacier',
  'grassland',
  'scorched',
  'swamp',
  'taiga',
  'temperate',
  'tropical',
]

/**
 * Deterministic string hash (FNV-1a) → non-negative int32. Pure, stable across runs/platforms — no
 * reliance on object key iteration order or locale-sensitive string ops. Exported for the assignment-table
 * unit tests. @param {string} s @returns {number}
 */
export function hash_string(s) {
  let h = 0x811c9dc5 // FNV offset basis
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193) // FNV prime
  }
  return h >>> 0
}

/**
 * The track name assigned to `biome` — a deterministic biome-name hash into `pool`, assigning one track
 * per biome purely from the biome name. Same biome name -> same track, always; there
 * is no curated per-biome row and no silence fallback — the world already has more biomes than owned
 * tracks, and every one of them resolves to exactly one pair. Pure + an injectable pool for testing.
 * @param {string} biome @param {readonly string[]} pool @returns {string}
 */
export function track_for_biome(biome, pool = TRACK_NAMES) {
  return pool[hash_string(biome) % pool.length]
}

// Walrus (boot manifest) first — the decentralized home — else the CDN (progressive migration). Resolved
// lazily per call (not at module init) so a manifest fetched after boot still wins. The `music` quilt is
// keyed by filename, so `${ASSETS_URL}/music/arctic.mp3` maps to identifier `arctic.mp3`. The quilt-patch
// URL carries the `.mp3` extension, so <audio> streams it even though the aggregator sets no content-type.
/** @param {string} cdn_url @returns {string} */
const walrus_music_url = (cdn_url) => walrus_asset_url('music', cdn_url.split('/').pop() ?? '') ?? cdn_url

/** The armed zone's bed PAIR — roam `${name}.mp3` + its battle TWIN `${name}_battle.mp3`, both off the SAME
 * hash-assigned track name (so a fight in an arctic zone plays arctic_battle, never a foreign battle track).
 * Exported for the twin-invariant unit test. @param {string} biome @returns {{ roam: string, battle: string } | null} the pair, or null for a falsy biome */
export function resolve_tracks(biome) {
  if (!biome) return null
  const name = track_for_biome(biome)
  return {
    roam: walrus_music_url(`${ASSETS_URL}/music/${name}.mp3`),
    battle: walrus_music_url(`${ASSETS_URL}/music/${name}_battle.mp3`),
  }
}

const STORAGE_KEY = 'ares_music'

// ---------------------------------------------------------------------------------------------
// module state (all null until the engine builds the players)
// ---------------------------------------------------------------------------------------------

/** @type {HTMLAudioElement | null} */
let roam = null // calm roam loop
/** @type {HTMLAudioElement | null} */
let battle = null // fight loop

// Eased 0..1 mix levels + their targets. effective element volume = volume * duck_cur * <track>_cur.
let duck_cur = 0 // visibility/start/stop envelope (fade in from silence)
let duck_target = 0
let roam_cur = 1 // roam track presence (1 while roaming, ramps to 0 in combat)
let roam_target = 1
let battle_cur = 0 // battle track presence (ramps to 1 in combat)
let battle_target = 0

/** @type {number | null} */
let raf = null // running ramp-loop handle (null when settled)
let last_tick = 0 // perf clock of the previous ramp frame (0 = first frame this run)

let started = false
let user_muted = read_pref() // HUD mute preference — gates whether the armed zone sounds
let fight_music_muted = read_fight_music_pref() // separate pref — gates ONLY the battle-bed handoff
let volume = DEFAULT_VOLUME
let combat = false // true while a fight is active → hand off to the battle track (see set_combat)
let teardown_gen = 0 // bumped on every start/stop so a pending engine_stop teardown can be cancelled

// SELF-ARM LATCH (root-cause fix, world-fight silence): true while the CURRENTLY armed zone was auto-armed by
// set_combat itself (never by set_zone_music/dungeon_store's in_session latch). A WORLD fight has no follow-cam
// and never flips in_session (world_fight.js keeps it false on purpose — it would wrongly force the dungeon's
// arctic bed), so NOTHING ever called set_zone_music before combat began: `started` was permanently false, and
// set_combat's old `if (!started) return` made the battle bed a no-op forever (the exact "fight music never
// starts" bug — reproduced live: no zone armed + set_combat(true) → zero Audio activity). set_zone_music /
// stop_zone_music (real external arms — dungeon today, a future follow-cam) always clear this flag, so we only
// ever tear down OUR OWN auto-arm on combat-exit, never someone else's zone.
let self_armed = false

/**
 * The armed zone's biome (null = no zone = the DEFAULT, no biome music). Set ONLY by set_zone_music (the
 * follow-cam trigger), cleared by stop_zone_music. THE FOLLOW-GATE: biome music never sounds while null.
 * @type {string | null}
 */
let current_biome = null

const music_heal = create_music_self_heal({
  get_players: () => ({ roam, battle }),
  get_active_players: () => (combat && !fight_music_muted ? { roam: null, battle } : { roam, battle: null }),
  get_tracks: () => resolve_tracks(current_biome),
  is_active: () => started && !user_muted && current_biome != null,
})

// ---------------------------------------------------------------------------------------------
// the ramp loop — one linear-ease tween driving the selected bed's duck/volume mix
// ---------------------------------------------------------------------------------------------

/** @param {number} v @returns {number} v clamped to 0..1 */
const clamp01 = (v) => Math.max(0, Math.min(1, v))

/**
 * Move `cur` toward `target` by at most `step`, never overshooting.
 * @param {number} cur @param {number} target @param {number} step @returns {number}
 */
function approach(cur, target, step) {
  if (cur < target) return Math.min(target, cur + step)
  if (cur > target) return Math.max(target, cur - step)
  return target
}

/** Roam/battle mix targets follow the combat flag AND the fight-music preference (handoff endpoints) —
 *  fight music disabled keeps the roam bed through combat instead of crossfading to the battle track. */
function refresh_targets() {
  const battle_wanted = combat && !fight_music_muted
  roam_target = battle_wanted ? 0 : 1
  battle_target = battle_wanted ? 1 : 0
}

/** Write the current eased mix to the elements' volume. */
function apply() {
  if (roam) roam.volume = clamp01(volume * duck_cur * roam_cur)
  if (battle) battle.volume = clamp01(volume * duck_cur * battle_cur)
}

/** @param {number} now requestAnimationFrame timestamp */
function tick(now) {
  const dt = last_tick ? (now - last_tick) / 1000 : 0
  last_tick = now
  const step = FADE > 0 ? dt / FADE : 1

  duck_cur = approach(duck_cur, duck_target, step)
  roam_cur = approach(roam_cur, roam_target, step)
  battle_cur = approach(battle_cur, battle_target, step)
  apply()

  const settled = duck_cur === duck_target && roam_cur === roam_target && battle_cur === battle_target
  if (settled) {
    raf = null
    last_tick = 0
    return
  }
  raf = requestAnimationFrame(tick)
}

/** Start (or keep) the ramp loop running toward the current targets. */
function kick() {
  if (raf != null || typeof requestAnimationFrame === 'undefined') return
  last_tick = 0
  raf = requestAnimationFrame(tick)
}

// ---------------------------------------------------------------------------------------------
// localStorage preference (on/off only — this is a preference, allowed here)
// ---------------------------------------------------------------------------------------------

/** @returns {boolean} true if the user previously muted */
function read_pref() {
  if (typeof window === 'undefined') return false
  try {
    return window.localStorage.getItem(STORAGE_KEY) === 'off'
  } catch {
    return false
  }
}

/** @param {boolean} muted */
function write_pref(muted) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORAGE_KEY, muted ? 'off' : 'on')
  } catch {
    /* private mode / disabled storage — preference just won't persist */
  }
}

const FIGHT_MUSIC_STORAGE_KEY = 'ares_fight_music'

/** @returns {boolean} true if the user previously disabled fight music */
function read_fight_music_pref() {
  if (typeof window === 'undefined') return false
  try {
    return window.localStorage.getItem(FIGHT_MUSIC_STORAGE_KEY) === 'off'
  } catch {
    return false
  }
}

/** @param {boolean} muted */
function write_fight_music_pref(muted) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(FIGHT_MUSIC_STORAGE_KEY, muted ? 'off' : 'on')
  } catch {
    /* private mode / disabled storage — preference just won't persist */
  }
}

// ---------------------------------------------------------------------------------------------
// visibility — duck to silence when hidden, swell back when visible.
// ---------------------------------------------------------------------------------------------

function on_visibility() {
  if (!started || user_muted) return
  duck_target = document.visibilityState === 'hidden' ? 0 : 1
  kick()
}

// ---------------------------------------------------------------------------------------------
// playback engine (built lazily; biome-parameterised). Pure mechanics — the mute preferences and the
// armed zone are policy decided by the public callers below.
// ---------------------------------------------------------------------------------------------

/** @param {string} url @returns {HTMLAudioElement} a looping, preloaded bed */
function make_audio(url) {
  const a = new Audio(url)
  a.loop = true
  a.preload = 'auto'
  a.addEventListener('error', music_heal.on_load_error)
  return a
}

// SOFT ZONE CROSSFADE (per-region music): multiple region beds ship now, so a zone
// switch is no longer a hard src cut — retune dips the duck envelope to silence over FADE, swaps the
// srcs at the trough, and swells back (respecting the hidden-tab duck). Generation-guarded so rapid
// region flips / a stop / a fresh start mid-dip cancel the pending swap instead of resurrecting audio.
let retune_gen = 0

/** @param {{ roam: string, battle: string }} tracks */
function engine_retune(tracks) {
  const my = ++retune_gen
  music_heal.stop(false) // suspend recovery but let the ONE active bed reach the fade trough before the swap
  duck_target = 0
  kick()
  setTimeout(() => {
    if (my !== retune_gen || !started) return // superseded by a newer retune/stop/start — abort the swap
    // The manifest can land during this fade; resolve again at commit so stale /assets fallbacks never win.
    const live_tracks = resolve_tracks(current_biome) ?? tracks
    if (roam && roam.src !== live_tracks.roam) {
      roam.src = live_tracks.roam
      roam.load()
    }
    if (battle && battle.src !== live_tracks.battle) {
      battle.src = live_tracks.battle
      battle.load()
    }
    duck_target = typeof document !== 'undefined' && document.visibilityState === 'hidden' ? 0 : 1
    music_heal.start()
    kick()
  }, FADE * 1000)
}

/**
 * Build (first run) or resume the bed pair for `tracks`; only the state-selected element plays. Idempotent:
 * resumes a stopped/ducked session (a same-src repoint is a no-op). A DIFFERENT zone's tracks while running
 * route through engine_retune (fade-out/swap/fade-in) from set_zone_music; the repoint branch below remains
 * the resume/fallback path (unmute, visibility swell).
 * @param {{ roam: string, battle: string }} tracks
 */
function engine_start(tracks) {
  retune_gen++ // a fresh start supersedes any pending retune swap
  if (started) {
    // already running — repoint the beds if the biome changed, else just resume + swell.
    if (roam && roam.src !== tracks.roam) {
      roam.src = tracks.roam
      roam.load()
    }
    if (battle && battle.src !== tracks.battle) {
      battle.src = tracks.battle
      battle.load()
    }
    music_heal.start()
    duck_target = 1
    kick()
    return
  }

  started = true
  roam = make_audio(tracks.roam)
  battle = make_audio(tracks.battle)

  // start silent, then ramp the selected bed up; handoff endpoints follow the combat flag
  duck_cur = 0
  duck_target = 1
  refresh_targets()
  roam_cur = roam_target
  battle_cur = battle_target
  apply()

  music_heal.start()

  document.addEventListener('visibilitychange', on_visibility)
  kick()
}

/** Pause the live bed now and release its pair after the teardown grace; preferences/zone stay untouched. */
function engine_stop() {
  if (!started) return
  music_heal.stop()
  retune_gen++ // a stop supersedes any pending retune swap (never resurrect audio mid-teardown)
  duck_target = 0
  kick()
  document.removeEventListener('visibilitychange', on_visibility)

  const my_gen = ++teardown_gen
  const dying_roam = roam
  const dying_battle = battle

  // Delay element release so an immediate resume can reuse the already-buffered pair.
  setTimeout(
    () => {
      if (my_gen !== teardown_gen) return // an engine_start landed during the fade — keep playing
      dying_roam?.pause()
      dying_battle?.pause()
      if (roam === dying_roam) roam = null
      if (battle === dying_battle) battle = null
      started = false
    },
    (FADE + 0.1) * 1000
  )
}
export const suspend_zone_music = engine_stop
export function resume_zone_music() {
  if (!current_biome || user_muted) return
  teardown_gen++
  engine_start(resolve_tracks(current_biome))
  document.addEventListener('visibilitychange', on_visibility)
}
// Follow-cam zone API — the follow-cam workstream calls these to turn biome music ON/OFF.
/**
 * Turn the world/biome music ON for `biome` — the FOLLOW-CAM trigger. Arms the zone, (re)builds the
 * roam+battle pair for that biome and plays only the bed selected by the current combat state. Respects
 * the user's mute preference: if they muted music, the zone is armed but stays SILENT until they unmute.
 * Idempotent for the same biome. The module boots with NO zone, so biome music NEVER plays until this is
 * called. Must be reached from a user gesture (browsers block audio otherwise — the click that starts
 * following counts).
 * PER-REGION KEYS: `biome` is any zone identity string — a plain biome name OR the
 * region-qualified `${world}:${region}` key the region follower arms — hash-assigned onto the 9 owned pairs
 * either way (track_for_biome). A DIFFERENT key fades out, swaps, then fades in (engine_retune) instead of
 * hard-cutting; the same key resumes.
 * @param {string} biome any zone identity string — hash-assigned to one of TRACK_NAMES, never silent
 * @returns {void}
 */
export function set_zone_music(biome) {
  if (typeof window === 'undefined') return
  const tracks = resolve_tracks(biome)
  if (!tracks) {
    // falsy biome (no name to hash) — nothing to play; clear any prior zone.
    stop_zone_music()
    return
  }
  const switching = current_biome !== null && current_biome !== biome
  if (current_biome !== biome) game_log('music', `zone ${current_biome ?? 'none'} → ${biome} (D226 single-switch)`)
  current_biome = biome
  self_armed = false // a REAL external arm (dungeon/follow-cam) owns this zone now — combat-exit must never touch it
  if (user_muted) return // zone armed, but the user opted out of music — stay silent
  teardown_gen++ // cancel any pending engine_stop teardown
  if (switching && started)
    engine_retune(tracks) // live zone change → fade-out/swap/fade-in, never two simultaneous streams
  else engine_start(tracks)
}

/**
 * Turn world/biome music OFF on dungeon/session exit. Pauses immediately, tears down, and clears the zone.
 * Does NOT touch the mute preference, so a later
 * follow still respects whether the user wants sound.
 * @returns {void}
 */
export function stop_zone_music() {
  if (current_biome) game_log('music', `zone ${current_biome} → none (D226 single-switch)`)
  current_biome = null
  self_armed = false // the zone (ours or a real caller's) is gone either way — nothing left for combat-exit to tear down
  engine_stop()
}

// ---------------------------------------------------------------------------------------------
// HUD mute toggle (start / stop / toggle / is_playing) — the bottom-left speaker button. A persisted
// on/off PREFERENCE layered over the armed zone: it gates whether the zone's beds sound, it does NOT
// itself pick a biome. In the plain world view (no zone) it is a silent no-op — nothing to play until
// the player follows a character.
// ---------------------------------------------------------------------------------------------

/**
 * Clear the muted preference and resume the armed zone (if any). A no-op for audio when no zone is armed
 * (the world view) — it just records that the user wants sound, so the next set_zone_music will play.
 * @returns {void}
 */
export function start() {
  if (typeof window === 'undefined') return
  user_muted = false
  write_pref(false)
  teardown_gen++ // cancel any pending engine_stop teardown
  if (!current_biome) return // no armed zone (not following) — nothing to play yet
  const tracks = resolve_tracks(current_biome)
  if (!tracks) return
  engine_start(tracks)
}

/**
 * Set the muted preference and pause music. Keeps the armed zone, so unmuting (or a re-follow)
 * resumes it.
 * @returns {void}
 */
export function stop() {
  user_muted = true
  write_pref(true)
  engine_stop()
}

/** @returns {boolean} true while a zone is armed, playing, and the user hasn't muted (music is audible) */
export function is_playing() {
  return started && !user_muted && current_biome != null
}

/** @returns {boolean} true unless the user muted music — the SETTINGS-page reading, independent of whether
 *  a zone happens to be armed right now (unlike is_playing, which also requires an armed zone). */
export function is_music_enabled() {
  return !user_muted
}

/** Flip the HUD mute toggle. @returns {void} */
export function toggle() {
  if (is_playing()) stop()
  else start()
}

// ---------------------------------------------------------------------------------------------
// FIGHT-MUSIC preference — a separate persisted on/off gating ONLY the battle-bed handoff (music, fight
// music, and sound effects are independently disableable). Independent of the HUD mute above:
// disabling fight music keeps the roam bed playing straight through combat instead of crossfading to the
// -battle track; disabling the whole MUSIC preference (stop()) still silences everything, fight included.
// ---------------------------------------------------------------------------------------------

/** @returns {boolean} true unless the user disabled fight music */
export function is_fight_music_enabled() {
  return !fight_music_muted
}

/**
 * Enable/disable the battle-bed handoff. Takes effect immediately: disabling switches back to the roam bed
 * (or stays silent if no zone is armed); re-enabling mid-fight switches to the preloaded battle twin.
 * @param {boolean} enabled @returns {void}
 */
export function set_fight_music_enabled(enabled) {
  fight_music_muted = !enabled
  write_fight_music_pref(!enabled)
  refresh_targets()
  // The pair is already pointed at the current zone; music_heal atomically pauses the prior bed, selects the
  // preference-appropriate twin, and skips play() when that same element is already active.
  if (combat && started) music_heal.play()
  kick()
}

// ---------------------------------------------------------------------------------------------
// shared controls (volume + combat handoff)
// ---------------------------------------------------------------------------------------------

/**
 * Set the master volume (0..1). Takes effect immediately, and is remembered for the next start.
 * @param {number} v
 * @returns {void}
 */
export function set_volume(v) {
  volume = clamp01(v)
  apply()
}

// ---------------------------------------------------------------------------------------------
// FIGHT MUSIC = THE ARMED ZONE'S `_battle` TWIN: the battle bed is the zone's own twin — if the roam
// bed picked arctic for a biome, a battle in this biome plays arctic_battle. engine_start builds
// BOTH beds from resolve_tracks(current_biome) — roam `${name}.mp3` + battle `${name}_battle.mp3` — so the
// battle bed is ALREADY the current zone's twin; set_combat hands off to it (NO independent random
// pick — the old global FIGHT_TRACKS roll could play a DIFFERENT biome's battle than the zone playing, which
// broke this spec). A context-less world fight self-arms a random BIOME (pick_random_biome) whose OWN twin
// then plays — region-consistent by construction. Supersedes the earlier "choose randomly" ask (D-2710/D226).
// ---------------------------------------------------------------------------------------------

/**
 * Uniformly pick one name from TRACK_NAMES — set_combat's SELF-ARM pick (see self_armed) for a fight with
 * no zone armed at all (a world fight). Injectable `rand`, mirroring pick_fight_track, so the self-arm
 * decision is deterministically testable. TRACK_NAMES always has ≥1 row, so this never returns undefined.
 * @param {() => number} rand
 * @returns {string} a TRACK_NAMES member
 */
export function pick_random_biome(rand = Math.random) {
  return TRACK_NAMES[Math.floor(rand() * TRACK_NAMES.length)]
}

/**
 * Hand off between the roam bed and combat twin — call with `true` on fight enter and `false` on exit.
 * The previous element pauses before the next plays, so iOS never owns two live media streams. Idempotent;
 * user muted — respects the mute preference exactly like a real zone arm (a fight must never force-unmute).
 *
 * SELF-ARMS on the rising edge when NO zone is armed yet (self_armed above): a WORLD fight arms no zone at
 * all — set_zone_music's only caller is dungeon_store's in_session latch, and world_fight.js deliberately
 * never flips in_session for a world fight (it would wrongly force the dungeon's arctic bed) — so `started`
 * was PERMANENTLY false and this used to be a silent no-op forever (ROOT CAUSE of "fight music never
 * starts": reproduced live — no zone armed + set_combat(true) → zero Audio activity, every time, not a
 * race). Picks a random biome pair (uniform random selection, per T-81) so the
 * battle bed has something to swell into. Tears its OWN auto-arm back down on the falling edge — never a
 * REAL external zone's, since set_zone_music/stop_zone_music always clear self_armed the instant an external
 * caller owns the zone — so the world returns to its documented OFF-BY-DEFAULT silence once the fight ends,
 * exactly like a dungeon exit.
 *
 * Once a zone exists (self-armed or real), the RISING edge switches to the battle bed that
 * engine_start already pointed at the current zone's `${biome}_battle.mp3` twin (e.g. arctic→arctic_battle)
 * — NO random repoint. The falling edge switches back to the already-preloaded roam twin.
 *
 * FIGHT-MUSIC PREFERENCE gate (is_fight_music_enabled): disabled fight music must never CONJURE new music —
 * so the self-arm (below) is skipped outright when fight music is off (a world fight then stays exactly as
 * silent as it was pre-fight, instead of surprising the player with a random ROAM bed). refresh_targets()
 * above already keeps roam_target at 1 in that case, so an already-armed zone just plays straight through the fight.
 * @param {boolean} active
 * @returns {void}
 */
export function set_combat(active) {
  if (combat === active) return
  combat = active
  refresh_targets()

  // FALLING edge tearing down OUR OWN self-arm (see self_armed) — checked BEFORE the no-zone gate below
  // because a self-arm made while user_muted never actually started the engine (set_zone_music stays
  // silent-but-armed for a muted user), yet still left current_biome/self_armed set; without this a later
  // HUD unmute would resurrect a random biome's ROAM bed outside of combat, breaking OFF-BY-DEFAULT.
  if (!active && self_armed) {
    self_armed = false
    stop_zone_music()
    return
  }

  if (!current_biome) {
    if (!active || fight_music_muted) return // no zone + (leaving OR fight music off) — nothing to self-arm for
    const biome = pick_random_biome()
    game_log('music', `combat with no zone armed — self-arming ${biome} (world-fight fix)`)
    set_zone_music(biome)
    self_armed = true
    return
  }

  // The battle bed is ALREADY the current zone's `_battle` twin (engine_start built it from
  // resolve_tracks(current_biome)); hand off without a random repoint (that broke arctic→arctic_battle).
  const to_battle = active && !fight_music_muted
  game_log(
    'music',
    `handoff → ${to_battle ? 'battle' : 'roam'} bed (${current_biome}, its _battle twin) (D226 single-switch)`
  )
  music_heal.play()
  kick()
}
