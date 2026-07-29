// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { lazy, Profiler, Suspense, useEffect, useRef, type CSSProperties, type ReactElement } from 'react'
import { useLocation } from 'react-router-dom'
import { plan_scene } from '@aresrpg/world/session_gate'

import { use_auth, type AuthState } from './auth'
import { use_spectate_gate } from './stores/spectate_gate'
import { use_follow } from './follow'
import { use_mobile_mode } from './game/screens/hud/mobile_layout.js'
import { use_world_binding, reset_world_binding, fetch_world_binding, end_join } from './world-shell/session_gate.js'
import { resolve_world_biome } from './world-shell/world_biome.js'
import { resolve_checkpoint_spawn } from './world-shell/world_checkpoint.js'
import { restore_world_position } from './world-shell/spawns_adapter.js'
import { TouchControlsLayer } from './game/touch/TouchControls.jsx'
import { use_mobile_input_mode, use_mobile_touch_hygiene } from './game/touch/mobile_input_mode.js'
import './game/touch/touch-hygiene.css'
import { game_log } from './core/log.js'
import { report_error } from './core/report.js'
import { use_toast } from './toast'
import i18n from './i18n'
import { destroy_scene_and_leave_lobby } from './world-shell/scene_lifecycle.js'

// The PERSISTENT, always-on game-world canvas host (drift-#4 boot-routing law). It is mounted once,
// BEHIND the companion's routed meta pages, and it never mounts/unmounts on navigation. On the FIRST
// /game-world enter it lazily boots the game engine (dynamic import -> own chunk), hands the
// companion session in via the one-way bridge, selects the player's character, and mounts the REAL
// imperative Three roam scene (live world + map + the character sprite). The engine + WS then stay
// ALIVE in the background; only the 3D RENDER pauses (rAF stopped + canvas hidden) when the player is
// on a meta tab, resuming on return. The companion P2 in-world HUD overlays it as a SEPARATE sibling
// layer (never a React child of the host — the host holds only the imperatively-appended scene root).

// The P2 in-world HUD (minimap / toasts / chat / vitals / online list). LAZY so the game engine it
// statically imports stays OUT of the eager app bundle (same lazy-boot contract as the scene). Maps
// the named export to lazy()'s default-shaped module without adding a default export.
const GameWorldHud = lazy(() =>
  import('./game/screens/hud/world/GameWorldHud.jsx').then((m) => ({
    default: m.GameWorldHud,
  }))
)

// CPU diagnostics stay in a separate lazy chunk. Without ?cpu=1 the overlay's game-core import never
// executes, no observer/listener mounts, and React.Profiler is absent from the tree.
const CpuOverlay = lazy(() =>
  import('./game/screens/hud/world/CpuOverlay.jsx').then((m) => ({
    default: m.CpuOverlay,
  }))
)
const CPU_ENABLED = typeof location !== 'undefined' && new URLSearchParams(location.search).get('cpu') === '1'
const cpu_profiler_on_render = (
  _id: string,
  _phase: 'mount' | 'update' | 'nested-update',
  actual_duration: number,
  _base_duration: number,
  start_time: number,
  _commit_time: number
) => {
  if (!CPU_ENABLED || actual_duration <= 0 || typeof CustomEvent === 'undefined') return
  window.dispatchEvent(
    new CustomEvent('ares:cpu-span', {
      // Profiler exposes render duration, not commit-phase DOM mutation time. Anchor that duration at React's
      // own render start instead of back-projecting from commitTime across scheduler/yield gaps.
      detail: { system: 'react', start_ms: start_time, end_ms: start_time + actual_duration },
    })
  )
}

// Confirmed-empty onboarding owns the SAME bounded frame as the canvas. Its inline creator paints over the
// world below the mobile HUD's MENU controls, so desktop sidebar/wallet and mobile navigation remain reachable.
const WorldCharacterCreate = lazy(() =>
  import('./game/screens/hud/world/WorldCharacterCreate.jsx').then((m) => ({
    default: m.WorldCharacterCreate,
  }))
)

// HACK MODE'S ALBUM RADIO (owner ruling, 07-27): must persist across EVERY page while hack mode is armed —
// unlike GameWorldHud, mounted here UNGATED by `active`/`show_world` (this host's own `in_app` is enough; the
// widget self-gates on the session's hack-mode presentation and fight state, see HackRadioPlayer.jsx). Its
// own CSS is `position: fixed` to the viewport (game-world-hud.css), not this host's bounded canvas frame, so
// it floats over whichever route is showing. LAZY for the same reason as GameWorldHud — it statically imports
// the audio registry, which must stay out of the eager app bundle.
const HackRadioPlayer = lazy(() =>
  import('./game/screens/hud/world/HackRadioPlayer.jsx').then((m) => ({
    default: m.HackRadioPlayer,
  }))
)

interface SceneControls {
  set_paused: (paused: boolean) => void
  destroy: () => void
}

export function GameWorldHost(): ReactElement {
  const host = useRef<HTMLDivElement | null>(null)
  const scene = useRef<SceneControls | null>(null)
  // The mounted scene's identity key (spectate / follow / lobby / session) — re-mount when it changes.
  const mounted_key = useRef<string | null>(null)
  const boot_token = useRef(0)
  const location = useLocation()
  const address = use_auth((s: AuthState) => s.address)
  // Auth is still resolving a stored session until boot_auth flips is_loading false (Enoki reconnect / dev
  // wallet). Feeds the BOOT-ONCE hold below — a returning player must not mount the spectate world just to
  // dispose + re-boot it the instant the wallet reconnects (a redundant engine boot).
  const auth_loading = use_auth((s: AuthState) => s.is_loading)
  // FOLLOW (idle-exploration reframe): when the player follows a character the scene focuses that
  // character's idle-wandering avatar (+ biome music, owned by the follow store). Default = the lobby.
  const following = use_follow((s) => s.active)
  const mobile = use_mobile_mode()
  const mobile_input = use_mobile_input_mode()
  // The world tab is the BARE ROOT (no path segment) — exact match, startsWith('/') matches everything.
  const active = location.pathname === '/'

  // Fully inside the authenticated companion app (mirrors app.tsx). When NOT in-app the live world is
  // the page backdrop (spectate landing); in-app it shows only on the game-world tab. Chain-direct: holding
  // a Sui address IS being in-app — there is no server-link step.
  const in_app = !!address
  const show_world = active || !in_app
  use_mobile_touch_hygiene(mobile_input && show_world)

  // INTERACTION GATE: canvas input is ignored outside spectate/play. The canvas is DISPLAY-ONLY until the visitor chose
  // spectate OR is logged in — the CSS half (canvas-bound pointer/wheel), paired with the spectate camera's own
  // window-listener gate (embed_voxel_spectate.js) which CSS can't reach. Logged-in ⇒ always interactive.
  const spectate_chosen = use_spectate_gate((s) => s.chosen)
  const interactive = in_app || spectate_chosen
  const cpu_enabled = CPU_ENABLED

  // SPECTATE-UNTIL-JOINED: the selected character's WORLD BINDING gates the resident
  // session — a CONFIRMED-UNBOUND character gets the D183 spectate backdrop (no controller/physics/avatar)
  // while the auto-join runs; the join's publish flips this reactively and the scene swaps to resident.
  // UNKNOWN (undefined) stays on the session path — the boot effect decides POST-RESOLVE, so an already-
  // bound character enters resident DIRECTLY (no spectate flash).
  const bound_world = use_world_binding((s) => s.world)
  const bound_char_id = use_world_binding((s) => s.character_id)
  // ONE-BOOT create→play: a fresh create drives create → join → spawn as ONE loading HOLD.
  // While joining, the plan never yields spectate (no sky-view detour) and the host shows ONE loading veil;
  // the resident scene boots ONCE when the join resolves the world.
  const joining = use_world_binding((s) => s.joining)

  // THE scene plan (pure — unit-tested): the concrete ACTION + the mount-identity KEY. The KEY now encodes
  // the CHARACTER too, so a decorative lobby (no character) and the resident lobby (character X) are DIFFERENT
  // keys — the host boots into the freshly-created character reactively, WITHOUT the old spectate→resident
  // churn (that key change fixed the extra boot that used to flash as a mid-session reload).
  const { action, key: scene_key } = plan_scene({
    show_world,
    authenticated: !!address,
    on_world_tab: active,
    joining,
    world: bound_world,
    character_id: bound_char_id,
    following,
    auth_loading,
  })

  // A wallet/account switch resets the binding to UNKNOWN — a stale bound=true from the previous account
  // must never leak a controller into an unjoined world (the cross-account case).
  useEffect(() => {
    reset_world_binding()
    // Reset the spectate choice on any account change: a fresh login screen (logout, or a switch back to the
    // landing) must be display-only again — never inherit a prior session's "watch the live world" opt-in.
    use_spectate_gate.getState().set_chosen(false)
  }, [address])

  // WALLET-SWITCH SESSION RESET (P0/D286) moved to its SINGLE, route-independent home: a use_auth.subscribe in
  // auth/index.ts fires game/wallet_session_reset on any account change. It used to live HERE, but GameWorldHost
  // is not mounted on the standalone /mint page, so a wallet switch there left stale session state — the auth
  // subscription closes that gap and keeps one home. GameWorldHost still owns the scene remount + roster reload
  // below, which react to the new address after the reset has cleared the old account's session.

  // BOOT roster (S-53): resolve the player's characters in ONE call to the RPC read-API indexer
  // (boot_roster → GET /v1/characters?owner=…) the moment we are authenticated. Fast (<1s) and it CANNOT
  // teleport into a stale fight — the old chain-direct scan read a DEAD old-lineage DungeonRegistry and
  // tagged an escrowed char `in_dungeon`, which select_active_character auto-resumed. boot_roster fires a
  // background chain-direct load_roster() itself to hydrate the bag + full stats. Re-runs when the player
  // opens a roster surface (/characters or /game-world) so a just-created character appears WITHOUT a reload
  // (boot_roster is concurrency-guarded), and it lazy-loads its own chunk so the eager bundle stays clean.
  useEffect(() => {
    if (!address) return
    if (!location.pathname.startsWith('/characters') && location.pathname !== '/') return
    void import('./roster/boot_roster')
      .then(({ boot_roster }) => boot_roster())
      .catch((error) => {
        game_log('game-world', 'boot roster load failed', error)
        report_error(error, { area: 'game-world', action: 'boot_roster' })
      })
  }, [address, location.pathname])

  // STRANDED-CLAIM SWEEP: claiming is automatic at opening, or at refresh if it had failed. Once authenticated,
  // auto-collect any durable PetBoxClaim the fresh /v1 read still holds
  // (an interrupted or failed open's roll). Once per address per session (module-guarded), lazy chunk like
  // boot_roster, and the claim guard bounds it under the TX-RETRY law.
  useEffect(() => {
    if (!address) return
    void import('./world-shell/lootbox_actions')
      .then(({ sweep_stranded_claims }) => sweep_stranded_claims())
      .catch((error) => {
        game_log('game-world', 'stranded-claim sweep failed', error)
      })
  }, [address])

  // LOBBY AUDIO (music rework, 2026-07-13): the old YouTube-ripped lobby placeholder (menu_music.js) is
  // deleted outright, never replaced — the lobby is silent until a zone bed arms (ambient_music.js,
  // FOLLOW-GATED). No handoff to own here anymore; kept as a marker so a future lobby bed knows where the
  // old D226 two-way handoff used to live.

  // Lazy-boot / swap the scene to match the PLAN. The game chunk is dynamically imported on first need
  // (own bundle); a soft session-bridge failure still renders the live world. A monotonic token cancels
  // a superseded boot (e.g. spectate -> session on login) so concurrent transitions resolve to the plan.
  // ONE-BOOT create→play: the 'hold' action keeps ONE loading veil (never the spectate
  // detour) until the join resolves the world; then the resident scene boots ONCE with character + world
  // + biome + checkpoint all known. `mounted_key` records the ACTUAL mount identity (character-keyed) so
  // the binding-driven re-render matches and never remount-thrashes.
  useEffect(() => {
    // 'hidden' (meta tab) and 'await-auth' (BOOT-ONCE hold — auth still resolving a stored session) both mean
    // "do nothing": no mount, no dispose. await-auth holds whatever is up (nothing at boot, or the landing's
    // spectate scene during a login handshake) until auth decides, then flips to resident/session in ONE boot.
    if (action === 'hidden' || action === 'await-auth') return
    if (scene.current && mounted_key.current === scene_key) return
    const token = ++boot_token.current

    // The confirmed logged-out landing plans 'spectate' — the live world IS the login
    // backdrop again (the d6d32bc 'static' login gate is repealed in plan_scene; the watch-live-world
    // gesture survives below as the INTERACTION gate only).

    // HOLD — a create→play join is in flight and the world is not yet resolved. Tear down any non-resident
    // scene (the decorative lobby that booted behind the create form) and show the ONE loading veil (rendered
    // below on `joining`). The resident scene boots when the plan flips to 'resident' (the join landed).
    if (action === 'hold') {
      if (scene.current) {
        game_log('boot-trace', `dispose ${mounted_key.current} → join-hold`)
        scene.current.destroy()
        scene.current = null
      }
      mounted_key.current = scene_key
      game_log('boot-trace', 'HOLD — loading veil up (spectate detour suppressed)')
      return
    }

    void (async () => {
      let game: typeof import('./game/embed.js')
      try {
        game = await import('./game/embed.js')
      } catch (error) {
        // a failed game-chunk load is a DEAD END (no world ever mounts) — honest toast + loud report,
        // never a silent return into a black screen.
        game_log('game-world', 'failed to load the game bundle', error)
        report_error(error, { area: 'game-world', action: 'load_game_bundle' })
        use_toast.getState().add(i18n.t('errors.world_load_failed'), 'error')
        return
      }
      if (token !== boot_token.current) return
      let character: unknown = null
      let follow = false
      let mount_spectate = action === 'spectate'
      // The RESOLVED bound world (hoisted so the mount-identity key below can carry it — the local `world` const
      // is block-scoped to the char branch). Stays null for spectate/unbound/unknown → a character-only key.
      let mounted_world: string | null = null
      if (action !== 'spectate') {
        // SESSION / RESIDENT — resolve the player's selected roster character (last-played, else first) from the
        // engine roster. A confirmed-empty roster (brand-new / char escrowed in a run) → null → decorative world.
        // bound_char_id (#221): a LIVE switch already re-keyed the session-gate binding above (that's WHY this
        // effect re-ran — scene_key changed) — hand it straight to the resolver so the mount trusts the switch's
        // own outcome instead of re-deriving a possibly-stale answer from the persisted last-played preference.
        const resolve_character = async () => {
          try {
            return await game.select_active_character(bound_char_id)
          } catch (error) {
            game_log('game-world', 'character select failed', error)
            report_error(error, { area: 'game-world', action: 'select_character' })
          }
          return null
        }
        if (following) {
          // FOLLOW: focus + idle-explore the followed character. The HUD passes an explicit descriptor (e.g.
          // the character on its active run); fall back to the selected roster character when none was given.
          // No resolvable character (e.g. char escrowed mid-run with no descriptor) → null → decorative backdrop.
          character = use_follow.getState().character ?? (await resolve_character())
          if (token !== boot_token.current) return
          follow = true
        } else {
          // INTERACTIVE LOBBY DEFAULT (WS-B, final-design plan decision #7): the World tab is the p2p social
          // lobby — the focused, mouse-or-keys-controllable live-world avatar. A confirmed-empty roster resolves
          // null → the decorative world (no character yet).
          character = await resolve_character()
          if (token !== boot_token.current) return
          const char_id = (character as { id?: string } | null)?.id ?? null
          if (char_id) {
            // TRUST the binding store when it already carries THIS character's world (chain-truth published by
            // the join / a prior read): a 'resident' plan skips the /v1 re-read that could re-null a just-joined
            // character (which caused a spurious extra spectate flash). An UNKNOWN binding ('session' plan) fetches;
            // a fetch that returns null (CONFIRMED-UNBOUND) preserves the S-57 legacy spectate pre-load.
            const world =
              action === 'resident' && typeof bound_world === 'string'
                ? bound_world
                : await fetch_world_binding(char_id)
            if (token !== boot_token.current) return
            if (world === null) {
              mount_spectate = true
              character = null // the D183 backdrop takes no avatar — same shape as the landing spectate
            } else if (world) {
              mounted_world = world // carry into the mount-identity key so a travel re-boots the scene

              // Resolve the on-chain CHECKPOINT and BIOME before consulting their synchronous mount-time caches:
              // the checkpoint anchors the local free-walk row, while the biome selects the engine recipe.
              // Only after both chain reads settle may the accepted local position re-enter through the spawns
              // reducer's `player_pos` input. A token check on each async boundary prevents an abandoned
              // character/world boot from hydrating the next one.
              const [chain_anchor] = await Promise.all([
                resolve_checkpoint_spawn(char_id, world),
                resolve_world_biome(world),
              ])
              if (token !== boot_token.current) return
              await restore_world_position(char_id, world, chain_anchor)
              if (token !== boot_token.current) return
            }
          }
        }
      } else if (use_follow.getState().active) {
        // Leaving the authenticated session (logout / spectate landing): a stale follow must not keep the zone
        // music alive once the scene is no longer the followed character's world. Guarded so the logged-out
        // landing doesn't needlessly touch the audio bridge. Otherwise the spectate scene is a DECORATIVE
        // backdrop only (no live feed — the p2p live-world feature returns at #19).
        use_follow.getState().unfollow()
      }
      if (!host.current) return
      // The mount KEY reflects the ACTUAL mount (a post-resolve unjoined → 'spectate'; a resolved character →
      // its lobby/follow:<id> key), so the binding-driven re-render matches and never remount-thrashes. The
      // resident LOBBY key carries the resolved WORLD id (mirrors plan_scene) so a travel A→B is a distinct
      // identity → dispose world A + boot world B; follow keeps its character-only key (no travel in follow).
      const char_id_key = (character as { id?: string } | null)?.id ?? 'none'
      const mounted = mount_spectate
        ? 'spectate'
        : follow
          ? `follow:${char_id_key}`
          : `lobby:${char_id_key}${mounted_world ? `:${mounted_world}` : ''}`
      if (scene.current && mounted_key.current !== mounted) {
        game_log('boot-trace', `dispose ${mounted_key.current} → ${mounted}`)
        scene.current.destroy()
        scene.current = null
      }
      if (!scene.current) {
        game_log('boot-trace', `MOUNT ${mounted} (plan=${action}, spectate=${mount_spectate})`)
        scene.current = game.mount_scene(host.current, character, {
          spectate: mount_spectate,
          follow,
        })
        scene.current.set_paused(!show_world || document.hidden)
        mounted_key.current = mounted
        // A terminal scene is up — release the create→play loading hold (idempotent no-op for normal boots,
        // where `joining` was never set). The engine's own first-load reveal covers the mount pop-in.
        end_join()
      }
    })()
  }, [show_world, scene_key, action, following, bound_world])

  // Render-pause when the world is hidden (on an authenticated meta-tab): keep the engine + WS alive,
  // stop the scene rAF, resume when shown. The host's display:none also hides the position:fixed scene.
  useEffect(() => {
    const sync_pause = () => scene.current?.set_paused(!show_world || document.hidden)
    sync_pause()
    document.addEventListener('visibilitychange', sync_pause)
    return () => document.removeEventListener('visibilitychange', sync_pause)
  }, [show_world, scene_key])

  // `/inbox` returns before this host in app.tsx. A real unmount must invalidate an in-flight boot and release
  // the current scene; otherwise the singleton watchdog can keep a detached canvas/session alive indefinitely.
  useEffect(
    () => () => {
      boot_token.current += 1
      const released_scene = scene.current
      scene.current = null
      mounted_key.current = null
      if (released_scene) {
        destroy_scene_and_leave_lobby(
          released_scene,
          () => !scene.current,
          (error) => report_error(error, { area: 'game-world', action: 'leave_unmounted_lobby' })
        )
      }
    },
    []
  )

  // Two framings: in the authenticated game-world the canvas floats as a rounded inset card right of the
  // 200px sidebar (224 = 12px page pad + 200px sidebar + 12px gap); on the spectate landing / connecting
  // (no sidebar) it is FULL-BLEED so the live world fills the page behind the glass login.
  // Mobile owns the full viewport: its HUD applies safe-area insets and in-game navigation lives behind MENU.
  // The false branch is the original desktop frame byte-for-byte.
  const card = in_app
  // Mobile is EDGE-TO-EDGE by construction: under index.html's viewport-fit=cover, a position:fixed layer at
  // 100lvw x 100dvh spans the whole physical screen — under the notch / Dynamic Island / home indicator — and
  // 100dvh tracks the URL-bar collapse natively. NO JS viewport measurement shadows it: visualViewport.width/
  // height are safe-area-EXCLUDED on iOS Safari under viewport-fit=cover (the letterbox root cause — the width
  // half was already fixed by sourcing innerWidth==100lvw; this drops the same-broken height source too). The
  // HUD chrome carries its own per-component --safe-* insets, so buttons stay clear of the island.
  const mobile_frame: CSSProperties = {
    position: 'fixed',
    top: 0,
    left: 0,
    width: '100lvw',
    height: '100dvh',
    borderRadius: 0,
  }
  const frame: CSSProperties = mobile
    ? mobile_frame
    : card
      ? {
          position: 'fixed',
          top: 12,
          right: 12,
          bottom: 12,
          left: 224,
          borderRadius: 14,
        }
      : { position: 'fixed', inset: 0, borderRadius: 0 }

  // transform creates a containing block so the scene's position:fixed root is clipped to the frame.
  // zIndex 11 lifts the canvas ABOVE the z-10 routed game-world spacer so its listeners get walk-clicks;
  // the spectate landing sits at z-20 (above this), the wallet/bottom bars at z-40, toasts at z-50.
  return (
    <>
      <div
        ref={host}
        data-testid="game-world-viewport"
        className={mobile_input ? 'mobile-game-input-surface' : undefined}
        aria-hidden={!active}
        style={{
          ...frame,
          zIndex: 11,
          overflow: 'hidden',
          transform: 'translateZ(0)',
          boxShadow: card
            ? '0 18px 50px rgba(0,0,0,.55), 0 0 0 1px rgba(255,255,255,.06), inset 0 0 0 1px rgba(255,255,255,.04)'
            : 'none',
          display: show_world ? 'block' : 'none',
          // INTERACTION GATE (CSS half): a display-only backdrop swallows no canvas-bound pointer/wheel events.
          // The spectate camera's WINDOW-bound drag is gated separately (embed_voxel_spectate.js) — CSS can't
          // reach a window listener. Logged-in play is always interactive (in_app ⇒ interactive).
          pointerEvents: interactive ? 'auto' : 'none',
        }}
      />
      {/* HUD overlay — a SEPARATE sibling layer over the card (never a child of the scene host).
          pointer-events:none lets empty-world clicks fall through to the canvas below; the panels
          re-enable pointer events themselves (.gw-hud > *). The confirmed-empty creator is another child
          of this bounded world frame, never a viewport overlay. Only over the authenticated world tab. */}
      {active && in_app && (
        <Suspense fallback={null}>
          <div
            className={mobile_input ? 'mobile-game-input-hud' : undefined}
            style={{ ...frame, zIndex: 12, pointerEvents: 'none' }}
          >
            {cpu_enabled ? (
              <Profiler id="game-world-hud" onRender={cpu_profiler_on_render}>
                <GameWorldHud />
              </Profiler>
            ) : (
              <GameWorldHud />
            )}
            <WorldCharacterCreate pathname={location.pathname} />
          </div>
        </Suspense>
      )}
      {/* M-04 — the touch movement/camera overlay (joystick + right-hand cluster). Its own position:fixed
          layer (touch-controls.css z-11), so it needs no frame wrapper; it self-gates to mobile mode AND
          the engine's armed-roam signal (null on desktop / mid-fight / while typing). */}
      {active && in_app && <TouchControlsLayer />}
      {cpu_enabled && (
        <Suspense fallback={null}>
          <CpuOverlay />
        </Suspense>
      )}
      {/* ONE-BOOT create→play loading veil: from the create tx landing until the resident
          scene boots, the app holds ONE honest "Entering the world" surface over the game-world card — no
          spectate sky-view detour, no visible decorative→resident boot churn. Gated on `joining` alone, so
          it never shows on a normal boot (joining is never set there). Covers the HUD (z-30 > 12) so the
          bare chrome doesn't flash mid-join; app-level toasts (z-50) still surface a join-failed message. */}
      {show_world && joining && (
        <div
          style={{
            ...frame,
            zIndex: 30,
            pointerEvents: 'auto',
            background: 'radial-gradient(ellipse at 50% 35%, #141420, #0a0a0f)',
          }}
          className="flex flex-col items-center justify-center gap-5"
        >
          <span className="w-6 h-6 rounded-full border-2 border-cyan/25 border-t-cyan animate-spin" />
          <div className="text-text text-[11px] tracking-[0.28em] uppercase">{i18n.t('auth.entering_world')}</div>
        </div>
      )}
      {/* HACK MODE'S RADIO — deliberately NOT gated on `active`/`show_world` (owner ruling): it must keep
          playing on every meta page, not just the world tab. Self-gates internally on the session's hack-mode
          presentation, so this is a no-op render everywhere else. `in_app` alone (not `address` again) keeps
          it off the logged-out spectate landing, matching every other authenticated-only overlay here. */}
      {in_app && (
        <Suspense fallback={null}>
          <HackRadioPlayer />
        </Suspense>
      )}
    </>
  )
}
