// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The companion P2 in-world HUD overlay (game-world tab) — PURE game visualization: the Play view is the
// live world plus only the genuine pure-game HUD essentials. The breadth
// (inventory / character / spells / jobs / quests / market / ...) lives in the companion META-TABS (the
// sidebar routes), NOT on the HUD, so this overlay no longer mounts the bottom-right launcher dock /
// right-drawers (removed). Layout — Option B "Minimal Float" (mockups/world-hud/optionB-lobby.png):
//   - party frame    → top-left      (PartyFrame, renders nothing solo)
//   - toast stack    → top-right      (Toasts, below)
//   - chat           → bottom-left    (WorldChat, lowered; online count folded into its header)
//   - self plate     → bottom-center  (SelfPlate, lobby-only: HP bar + XP sliver)
//   - vitals         → in the SPELL BAR (S-25: Vitals, fight-only, is the stat box LEFT of the spell-icon
//                      rows inside `.hud-spellbar`; it is no longer a standalone bottom-center card)
// The old minimap (WorldMinimap) and the standalone left-sidebar OnlinePlayers mount are DROPPED from this
// host per Option B (minimal chrome) — both files are kept for now, just unmounted here. The only retained
// overlay beyond the essentials is the first-session coachmark Tutorial, wrapped in the `.gw-tab
// gw-tab--carrier` token bridge (display:contents) so its tokens resolve to the companion palette without painting
// a box over the live world. Lazy-loaded by GameWorldHost so the game engine stays out of the eager app
// bundle. Companion tokens only (gold/cyan/JetBrains/sharp).

import { useEffect, useSyncExternalStore } from 'react'

import './game-world-hud.css'
import './world_toast_overlay.css'
// The proven in-game COMBAT chrome (turn-order cards, deck hand, ready/end-turn/abandon controls, the
// "position your team" / placement countdown, spell hover tooltip, board-hover tooltip, end-of-fight
// result + level-up). hud.css carries every `.hud-*` style these components use; it was previously only
// imported by the now-orphaned Hud.jsx (so the live companion HUD shipped NO fight chrome — #54). All
// `.hud-*` rules are namespaced (no `.gw-*` / global bleed), so importing it here is safe.
import '../hud.css'
import '../mobile-fight-hud.css'
import { use_game_state } from '../../../store.js'
import { select_hack_presentation } from '../../../core/world_presentation.js'
import { event_toast_store } from '../../../core/toast.js'
import { WorldChat } from './WorldChat.jsx'
import { PartyFrame } from './PartyFrame.jsx'
import { SelfPlate } from './SelfPlate.jsx'
import { OnlinePlayers } from './OnlinePlayers.jsx'
import { WorldSwitcher } from './WorldSwitcher.jsx' // S-67 → 07-17 redesign — current-world line + travel modal
import { PlayerActionMenu } from './PlayerActionMenu.jsx' // S-67 — shared "click a player" menu (add friend / invite)
import { QualitySelect } from './QualitySelect.jsx' // D157 — render-quality dropdown
import { apply_saved_tier } from './render_quality.js' // D157 — re-apply the persisted tier on world mount
import { NpcPrompt } from './NpcPrompt.jsx'
import { CompassStrip } from './CompassStrip.jsx' // PICK #3 — the 3A top-strip compass (pos+fps merged, zone TTL, spawn pips)
import { DayNightDriver } from './DayNightDial.jsx' // the always-on tod driver (the VISIBLE indicator is now the compass-strip progress line — DayNightBar, mounted by CompassStrip)
import { DiscoveryPrompts } from './DiscoveryPrompts.jsx'
import { ZoneRevealBanner } from './ZoneRevealBanner.jsx' // SEARCH-ZONE JUICE — center-screen reveal beat
import { ZoneSearchFlash } from './ZoneSearchFlash.jsx' // SEARCH-PRESS JUICE — on-press border-flash pulse
import { QuestObjectiveCard } from './QuestObjectiveCard.jsx' // ONBOARDING — the quest-ladder objective card
import { quest_store } from './quest_ladder_store.js' // ONBOARDING — quest-ladder visibility (toast-shift gate)
import { FightImpactFlash } from './FightImpactFlash.jsx' // FIGHT-FEEL — on-impact element flash + grade moments
import { PromptStack } from './PromptStack.jsx'
import { DungeonsModal } from './DungeonsModal.jsx'
import { FightsModal } from './FightsModal.jsx'
import { FightOpennessToggle } from './FightOpennessToggle.jsx'
// AUTO-SEARCH (#1106) — the scouting loop (walk a ranged zone, search it, stop at a wanted mob). It is a
// HACK-MODE surface, so it rides that grid's EXISTING visibility seam (select_hack_presentation, the same
// one HackRadioPlayer self-gates on) rather than the build mode: reachable on every build the moment the
// player arms hack mode, off the normal terrain HUD, and no second home for "is the dev entry showing".
// Every leg it fires is a real gas-burning transaction; the money safety is the FEE MODAL on each enable
// (the fold refuses to arm on a bare toggle), and unmounting here is a hard stop (`world_unbound`).
import { AutoSearchPanel } from '../../../dev/AutoSearchPanel.jsx'
import { Minimap } from '../Minimap.jsx' // CUBE-WORLD MINIMAP — top-right 3-D relief map (self-gates on pose)
import { HackRadioPlayer } from './HackRadioPlayer.jsx' // HACK MODE — the album radio (self-gates on hack)
import { CommissionModal } from './commission/CommissionModal.jsx'
import { Tutorial } from '../Tutorial.jsx'
import { FightControls } from '../FightControls.jsx'
import { FightTimeline } from '../FightTimeline.jsx'
import { FightPlacementBanner } from '../FightPlacementBanner.jsx'
import { TurnBanner } from '../TurnBanner.jsx'
// S-25 SPELL BAR — the gem Vitals box + the socket grid + the XP strip. It used to be declared at the bottom of
// THIS file and never exported, which is exactly why the simulator's fight phase could not cast (#916); it now
// lives in its own module and both compositions mount the SAME one.
import { SpellBar } from '../SpellBar.jsx'
import { EntityTooltip } from '../EntityTooltip.jsx'
import { FightResult } from '../FightResult.jsx'
import { FightSummary } from '../FightSummary.jsx'
import { LevelUp } from '../LevelUp.jsx'
import { JobLevelUp } from '../JobLevelUp.jsx'
import { MobileHud } from '../MobileHud.jsx'
import { MobileLayoutBoundary } from '../MobileLayoutBoundary.jsx'
import { fight_layer_class, use_mobile_mode, world_hud_class } from '../mobile_layout.js'
// CARD REMOVED: the ExploreHud exploration Shell (+ its "YOUR CHARACTERS" column) is gone from the
// World tab — exploration lives on /exploration, and the sidebar switcher covers RESUME. Confirmed-empty
// onboarding now lives at the GameWorldHost frame boundary, where it replaces the canvas without escaping
// over the app chrome.
// board #13 (WS-C wave C2): the on-chain SOLO dungeon board + its move/cast turn input. `fight_mode` is now
// ALSO raised by dungeon_store.js's engine bridge (no WS packets survive it — the backend is gone), so this
// discriminates the two: a dungeon fight has no spellbook/placement/end-turn-packet semantics, so
// DeckCluster/FightPlacementBanner/FightControls (all WS-packet-driven — see
// core/modules/fight.js's send_fight_* senders, dead without a backend) are swapped for DungeonBoard, which
// owns its own commit/pass-turn buttons wired to dungeon_store's real txs. FightTimeline + Vitals (below) ARE
// genuinely reusable as-is — pure fight-view readers (use_fight_view) with no wrong-sender problem.
import { use_dungeon } from '../../../../world-shell/dungeon_store.js'
import { DungeonBoard } from './DungeonBoard.jsx'
import { DungeonLeaveButton } from './DungeonLeaveButton.jsx'
import { RewardRecap } from './RewardRecap.jsx'
import { FightSyncIndicator } from './FightSyncIndicator.jsx'
import { use_fight_phase } from './use_fight_phase.js'
import { should_mount_board } from '../../../../fight-engine/phase.js'
import { use_fight_view } from '../../../store.js'

/** @returns {import('react').ReactElement} */
export function GameWorldHud() {
  // The first-session Tutorial mounts only with a PLAYABLE roster — when the roster is confirmed-empty,
  // GameWorldHost's world-slot creator owns the canvas region; before the roster is fetched, neither shows.
  // The breadth menus live in the companion meta-tabs (sidebar routes), never here.
  const loaded = use_game_state((s) => s.sui.loaded)
  const has_character = use_game_state((s) => s.sui.characters.length > 0)
  // ONBOARDING quest ladder: the objective card shows for a playable roster until every quest is resolved
  // (or dismissed). It's anchored center-right, clear of the top-right toast stack.
  const quest_active = useSyncExternalStore(quest_store.subscribe, () => !quest_store.get().hidden)
  const show_quest_card = loaded && has_character && quest_active
  const mobile = use_mobile_mode()
  // Tactical fight flag (engine store, set by core/modules/fight.js): combat replaces the world VIEW (the
  // board renders INTO the roam scene), so the combat chrome below mounts off this flag, not a panel set.
  const fight_mode = use_game_state((s) => s.fight_mode)
  // HACK GRID (#812's reducer-door signal, never a second read of the preference): the LIVE session's
  // presentation, so arming/disarming hack mode adds/removes the dev entry's surfaces without a reload.
  const hack_grid = use_game_state(select_hack_presentation)
  // VIEW-ONLY spectate: a spectator sends no commands, so the deck hand is hidden (the
  // turn controls become a "Leave spectate" — FightControls handles that itself).
  const spectating = !!use_fight_view()?.spectator // synchronous core view (S2 mirror kill)
  // is the CURRENT fight_mode a dungeon (chain-direct) or a WS fight? Only ever the former now (no backend),
  // but this keeps the WS combat chrome byte-identical/untouched for prod builds where a real backend exists.
  const in_dungeon = use_dungeon((s) => !!s.dungeon_id)
  // W4 PHASE MACHINE: the dungeon board's MOUNT is now the machine's call, not a raw `fight_mode && in_dungeon`
  // — it mounts in PLACEMENT/ACTIVE only, and HOLDS (no board) through a half-init (status ACTIVE but the slice
  // not yet re-synced — the D77 stuck-flip), so a ghost/half board is unrepresentable. The WS (non-dungeon)
  // branch below stays on the raw flag (the machine's input is the dungeon; a world fight has none).
  const phase = use_fight_phase()
  // P0 RESUME (supersedes the old interstitial): a refresh mid-fight mounts STRAIGHT into the
  // live phase — placement, active turn, or terminal — with zero "fight awaits / ENTER" gate. The mount is
  // the phase machine's call ALONE. (D107's tx-provenance half is untouched: mounting a BOARD signs nothing;
  // every fight-starting tx still demands a user gesture in the store.)
  const mount_dungeon_board = should_mount_board(phase)
  // CHAT-LIFT SCOPE (regression fix): the bottom-band chat only reflows UP when the spell chrome
  // is ACTUALLY mounted — keyed on the SAME condition as the SpellBar/board below (mount_dungeon_board, or the
  // dead WS branch), NOT the raw `fight_mode` slice. `fight_mode` stays true on the dungeon plane BETWEEN
  // fights (room-cleared/terminal teardown) where no spellbar mounts, so the old `fight_mode`-keyed marker
  // lifted the chat over an empty 170px band. This tracks the chrome, so out-of-fight the chat bottoms at 16px.
  const bottom_chrome = mount_dungeon_board || (fight_mode && !in_dungeon)

  // D157: re-apply the player's saved render-quality tier once the voxel engine handle is live (it boots
  // async, so apply_saved_tier polls briefly then gives up). No saved value → the engine's auto-governor
  // stays in charge. Runs once per world-HUD mount.
  useEffect(() => apply_saved_tier(), [])

  // DEV-ONLY fight-board harness (VfxLab analogue for the full fight HUD): registers
  // window.__ARES_DEV_FORCE_FIGHT_BOARD({state}) so design/qa can mount the rethemed fight chrome + board
  // with SYNTHETIC state every build (placement/active/victory/defeat) — QA/design are walled at reaching a
  // live active-fight board. Statically stripped from prod (import.meta.env.DEV → the branch + the dynamic
  // import drop). Injects synthetic slices only; never touches the real fight/chain flow.
  useEffect(() => {
    if (!import.meta.env.DEV) return
    let cleared = false
    // D139: the force_fight_board synthetic harness died with the isometric renderer it mounted (the voxel
    // path's dev hooks are window.__voxel_engine/__voxel_board in embed_voxel.js).
    // DEV cast hook (window.__ARES_DEV_CAST) — drives the REAL commit_turn cast path headlessly so qa can land
    // a spell (unblocks D16 AP/MP refill, D19 mob replay, the live float). Same DEV gate + tree-shake as above.
    import('../../../dev/dev_cast.js').then((m) => {
      if (!cleared) m.register_dev_cast()
    })
    // P0-sweep diagnostic hooks (__ARES_DEV_MOVE / __ARES_DEV_STATE) — live-instance access for the
    // headless drive (a Playwright-side /src import resolves a DEAD second Vite module instance; window
    // hooks close over the real stores). Same DEV gate + tree-shake.
    import('../../../dev/dev_probe.js').then((m) => {
      if (!cleared) m.register_dev_probe()
    })
    // Synthetic terminal-fight harness (__ARES_DEV_SYNTH_FIGHT/KILL) — the death-sequence gate's pixels rig
    // (revives the D139-dead force-board coverage on the voxel pipeline). Same DEV gate + tree-shake.
    import('../../../dev/dev_synth_fight.js').then((m) => {
      if (!cleared) m.register_dev_synth_fight()
    })
    // #1100 — the scripted fight bot's doors (__ARES_DEV_READ full-state read / __ARES_DEV_TURN batched
    // player turn). Same DEV gate + tree-shake; the simulator registers the identical pair, so ONE bot
    // drives both surfaces.
    import('../../../dev/dev_bot_seam.js').then((m) => {
      if (!cleared) m.register_dev_bot_seam()
    })
    // #1100 coop — the second seat's door (__ARES_DEV_WORLD_JOIN). WORLD-ONLY BY CONSTRUCTION: it imports the
    // chain entry, so it may never live in the seam module the simulator also registers (zero-drift's one
    // world-only row). Same DEV gate + tree-shake.
    import('../../../dev/dev_world_entry.js').then((m) => {
      if (!cleared) m.register_dev_world_entry()
    })
    return () => {
      cleared = true
    }
  }, [])

  return (
    <>
      {/* RESPONSIVE LAW — the spell section must never cover the chat: the root carries a spell-chrome
          marker so bottom-band siblings REFLOW around the fight chrome by ANCHOR (see game-world-hud.css
          .gw-hud--fight .gw-chat) — never by z-index (that only picks who gets buried). Keyed on the board
          mount (bottom_chrome), NOT raw fight_mode, so the chat never lifts over an unmounted spellbar. */}
      <div className={world_hud_class(mobile, bottom_chrome)}>
        {/* HUD-LAYOUT: render-quality selector moved to the BOTTOM-RIGHT (its old top-right slot
            is reserved for the minimap). Exploration-only — bottom-right is the fight controls' anchor, so it
            hides in a fight (the same gate the old day-night dial used for that corner; fight-HUD clutter law). */}
        {!mobile && !fight_mode && <QualitySelect />}
        {/* DAY-NIGHT: the renderless cycle driver advances the engine's tod (sky sun + coupled lights + the
            shading sun/shadow re-aim all follow) whenever the world HUD is up — including in a fight, so the
            overworld sky keeps cycling behind the board. The VISIBLE indicator is now the DayNightBar
            progress line on the compass strip (mounted by CompassStrip), which hides in fights with it. */}
        <DayNightDriver />
        {/* HACK MODE'S RADIO (top-right, over the minimap corner): the album streamed from our own asset host
            replaces our beds while the grid is armed. Self-gates on hack mode — nothing renders (and no
            manifest loads) off the grid. Mounted BEFORE the toast stack on purpose: same corner, same
            z-index, so a transient toast still paints over the permanent widget. */}
        <HackRadioPlayer />
        <Toasts />
        {/* ONBOARDING: the compact quest-ladder objective card (CENTER-RIGHT, design ruling 2026-07-13 — its old top-right
            slot is reserved for the minimap; compact in a fight). Self-hides when every quest is resolved. */}
        {!mobile && show_quest_card && <QuestObjectiveCard />}
        {/* SEARCH-PRESS JUICE: the on-press border-flash pulse (always mounted — idle/transparent until
            trigger_search_flash() fires from the [F] on_trigger). Sits before ZoneRevealBanner so both can
            paint independently (the flash is edge-only; the reveal banner is center-only — no visual clash). */}
        <ZoneSearchFlash />
        {/* FIGHT-FEEL: the on-impact element-coloured screen flash + grade moments (always mounted —
            idle/transparent until trigger_fight_flash() fires from the adapter's impact package on a cast
            landing). Edge-only vignette, so it never clashes with the center reveal banner. */}
        <FightImpactFlash />
        {/* SEARCH-ZONE JUICE: the one-shot center-screen zone-reveal banner (renders null unless a search
            just resolved — reveal_zone fires only from the [F] seam). A pure renderer of the reveal store. */}
        <ZoneRevealBanner />
        <MobileLayoutBoundary
          mobile={mobile}
          mobile_view={
            <MobileHud fight_mode={fight_mode} has_character={has_character} show_quest_card={show_quest_card} />
          }
          desktop_view={<WorldChat />}
        />
        {/* Option B "Minimal Float": PartyFrame (top-left) renders nothing solo; SelfPlate (bottom-center)
            is the always-on exploration HP plate. Both lobby-only — a board fight replaces them with the
            combat chrome's own Vitals (HP + AP/MP pips). The old minimap + standalone OnlinePlayers sidebar
            mount are dropped (minimal chrome; the online count now lives in the chat header). */}
        {/* Social cluster (top-left, design canon): MY party + OTHER online players to invite, stacked.
            OnlinePlayers is the item-25 invite entry (dropped from Option B's sidebar, slot reused by #29);
            re-homed here — top-right is the reserved toast zone. Lobby + embodied-player only. */}
        {!mobile && (
          <div className="gw-social">
            <PartyFrame />
            {/* Openness of the NEXT fight you start (HUD toggle): PUBLIC (anyone joins) vs GROUP (your party).
                Sits by the party frame — "group" IS your party. Pre-fight only (you set it before engaging). */}
            {!fight_mode && has_character && <FightOpennessToggle />}
            {!fight_mode && has_character && <OnlinePlayers />}
            {!fight_mode && has_character && <WorldSwitcher />}
            {/* AUTO-SEARCH (#1106) — directly under the world panel, on the hack grid only (the dev entry),
                plus this cluster's own exploration/embodied gate. Unmounting halts the loop. */}
            {hack_grid && !fight_mode && has_character && <AutoSearchPanel />}
          </div>
        )}
        {/* S-67 — the shared player-action menu (chat name click / in-world nameplate click). Renders null
            until a seam sets a target; portals to <body>, so mounting it here just keeps it in the HUD tree. */}
        <PlayerActionMenu />
        {/* PENDING-OUTCOME CHIP — REMOVED: the world HUD never surfaces internal settle state. The characters-panel
            PendingOutcomeBadge (CharactersDrawer.jsx) remains the ONE manual-fallback surface for a genuinely
            latched/dungeon-bound outcome (a stop-rule, tested — auto never improvises the settle_run leg);
            the toast copy ("open it from your character panel") already points there. The common-case race that
            used to flash this chip after a fight (a transient pre-flight settle failure whose retry stalled once
            claim() stopped the ambient poll) is fixed at the root in fight_claim_latch.js's run_signal_settlement
            (bounded self-driving liveness retry — no UI needed to observe it). */}
        {!fight_mode && <SelfPlate />}
        {/* PICK #3 (07-08, built 07-09 riders): the 3A TOP-STRIP COMPASS — cardinal ruler + camera-relative
            mob/resource pips off the chain-direct zone read, the zone discovered/REROLL-TTL line, and the
            relocated position+fps (the old embed_voxel DOM chip is deleted). Self-gates on the walker's
            pose publish, so it never paints over spectate; the fight chrome owns the top band in fights. */}
        {!fight_mode && <CompassStrip mobile={mobile} />}
        {/* CUBE-WORLD MINIMAP (top-right): live 3-D relief map of the voxel world, rotates with the camera;
            click opens the big map + entity overlay. Self-gates on pose; hidden in fights (world chrome law). */}
        {!fight_mode && <Minimap />}
        {/* S-25: during a fight the HP/AP/MP stat box (Vitals) is no longer a standalone bottom-center card —
            it moved INTO the spell bar below (left of the spell-icon rows). See the `.hud-spellbar` mounts. */}
        {/* WS-B lobby + S-18 discovery: proximity prompts render through the ONE PromptStack (bottom-center
            vertical stack — closest anchors, others stack UP). NpcPrompt (E dungeon)
            and DiscoveryPrompts (F search / G gather / R seam) are renderless SOURCES registering into it;
            the stack hides during a board fight. The dungeon modal shell is unchanged (WS-C fills it). */}
        <NpcPrompt />
        <DiscoveryPrompts />
        <PromptStack />
        {/* Nearby-fights DISCOVERY: the [V] PromptStack chip (world_fights_discovery.js — its label carries
            the in-range count) opens this panel. The old separate count-card indicator is deleted (owner
            2026-07-23: it was an unstyled duplicate of this same signal). */}
        <FightsModal />
        <DungeonsModal />
        {/* Artisan commissions (world-tab modal, mirrors DungeonsModal's mount): a store-flag-gated overlay
            (s.commissions_modal). Opened by the artisan NPC (parallel Move v2 lane) or the DEV window hook;
            all reads/writes behind the chain-decoupled commission_actions.js so it demos with mock data now. */}
        <CommissionModal />
        {/* board #47 (P0 LIVE-PLAY rework): NO post-enter modal — entering a dungeon drops the party into
            a distinct bounded plane (dungeon_dimension.js publishes the plane override; roam.js swaps terrain +
            teleports in). They're just IN the plane, free to move; clicking the mob cluster launches the fight
            (action/dungeon_engage → start_room). The old idle-room strip + join-window modal are removed. */}
        {/* The top-right "YOUR CHARACTERS" RosterPanel was REMOVED — merged into ExploreHud's single
            "Your characters" column (no duplicate char panel). RosterPanel.jsx deleted (S-65 janitor). */}
        {/* first-time coachmark tour (#15): a short Next/Skip spotlight over the live HUD + the sidebar
            meta-tabs, shown once per browser (a localStorage preference). It portals to <body> in its own
            `.gw-tab gw-tab--carrier` scope; the wrapper here keeps the token bridge for any retained overlay and
            is gated on the same playable roster. */}
        {loaded && has_character && (
          <div className="gw-tab gw-tab--carrier">
            <Tutorial />
          </div>
        )}
      </div>

      {/* Receipt-first entry: visible while the executed create/join id waits for its full board document. */}
      <FightSyncIndicator />

      {/* COMBAT chrome (#54 restore) — the proven fight HUD, ported VERBATIM from Hud.jsx (the orphaned
          fight-HUD host): turn cards, deck hand, ready/end-turn/abandon controls, the "position your team"
          placement countdown, spell hover tooltip, board-hover tooltip, end-of-fight result + level-up. It
          is a SIBLING of `.gw-hud` (not a child) so `.hud-root`'s own pointer-events:none survives `.gw-hud
          > * { pointer-events:auto }` and the 3D board cells (meshes, raycast) stay clickable. `.hud-root`'s
          transform makes it the containing block for the fixed fight children (game-world-hud.css re-bases
          it onto the game-area box so they clear the left sidebar). `.gw-tab` is the companion token
          BRIDGE (game-tab.css): tokens.css is not loaded in the companion app, so the game `.hud-*` styles
          would render token-less — `.gw-tab` supplies the companion-palette tokens (gold canon) that
          inherit into every fight component. Its drawer-host layout is neutralized in game-world-hud.css. */}
      <div className={fight_layer_class(mobile)}>
        {mount_dungeon_board && (
          <>
            {/* D242 rider — the placement no-dead-click banner + the "YOUR TURN" cue. MUST live in the DUNGEON
                region: dungeon is the ONLY fight type, so the legacy `!in_dungeon` block never mounts (in_dungeon
                is always true → the mount-tree bug qa caught: the #5 rider rendered nowhere). Both self-gate
                (FightPlacementBanner → placement, TurnBanner → my active turn). */}
            <FightPlacementBanner />
            <TurnBanner />
            {/* turn-order cards — left-center (REUSED as-is: pure fight-view reader) */}
            <FightTimeline />
            {/* board-hover tooltip — the fighter (mob OR player) under the cursor: name + team + HP */}
            <EntityTooltip />
            {/* S-25 SPELL BAR (the optE layout) — the gem Vitals box (big HP gem + AP/MP gems) on the LEFT,
                the fixed 2×10 socket grid + pager on the RIGHT, an XP strip under both. Left-click a socket to
                PICK (arm), then left-click a target cell to CAST (or press 1-9 / 0-for-weapon). DungeonBoard
                seeds fight.hand from the character's class spells. */}
            {!spectating && <SpellBar />}
            {/* A seatless observer never mounts DungeonBoard, the tactical input/settlement owner. It gets only
                FightControls' local Leave-spectate branch while the shared adapter renders the journal/courtesy view. */}
            {spectating ? (
              <div className="hud-bottom">
                <FightControls />
              </div>
            ) : (
              <DungeonBoard />
            )}
          </>
        )}
        {fight_mode && !in_dungeon && (
          <>
            {/* turn-order cards — left-center */}
            <FightTimeline />
            {/* board-hover tooltip — the fighter (mob OR player) under the cursor: name + team + HP */}
            <EntityTooltip />
            {/* spells UI — the deck hand (a spectator casts nothing, so hidden) */}
            {/* S-25 spell bar (same optE unit as the dungeon branch): gem Vitals left, socket grid + pager right */}
            {!spectating && <SpellBar />}
            {/* turn controls (End turn / Ready / Abandon) — bottom-right, clear of the bottom-center vitals
                + the deck hand (the companion freed the bottom-right dock). See .gw-fight-layer .hud-bottom. */}
            <div className="hud-bottom">
              <FightControls />
            </div>
          </>
        )}
        {/* PLANE "Leave dungeon" exit (unconditional) — the sibling of the mid-fight ABANDON: bottom-right
            (reuses `.gw-fight-layer .hud-bottom`), shown on the OPEN/ROOM_CLEARED plane where FightControls'
            own abandon isn't mounted (self-gates on in_session + status), so the player is never stranded. */}
        <DungeonLeaveButton />
        {/* D37c ROOM-CLEARED reward recap — a NON-GATING slide-in on the plane (off `room_recap`), shown after a
            room clears; never blocks movement or the next-cluster click. Renders null when the slice is empty. */}
        <RewardRecap />
        {/* end-of-fight result + defeat recap + level-up — gate off their OWN store slices (not fight_mode),
            so they persist a beat past the board teardown; each renders null when its slice is empty. */}
        <FightResult />
        <FightSummary />
        <LevelUp />
        <JobLevelUp />
      </div>
    </>
  )
}

// ── top-right toast stack ────────────────────────────────────────────────────────────────────────
// Binds to the engine's fire-and-forget event-toast stack (loot / xp / craft / presence). Dot tone:
// success → cyan (quest-like), error → red, else gold (neutral) — matches the mockup's gold/cyan dots.
const TOAST_CLASS = /** @type {Record<string, string>} */ ({
  success: ' gw-toast--q',
  error: ' gw-toast--err',
})

/** @returns {import('react').ReactElement | null} */
function Toasts() {
  const toasts = useSyncExternalStore(event_toast_store.subscribe, event_toast_store.get)
  if (toasts.length === 0) return null
  return (
    <div className="gw-toasts">
      {toasts.map((t) =>
        t.state === 'progress' ? (
          // S-18 discovery: the sticky "Searching Zone…" toast — breathing gold dot + live progress bar,
          // same stack/position (no new positions). Resolves into a normal success/error toast.
          <div key={t.id} className="gw-toast gw-toast--progress">
            <div className="gw-toast__head">
              <span className="gw-toast__dot gw-toast__dot--breathe" />
              <span>{t.title}</span>
            </div>
            <div className="gw-toast__bar">
              <div className="gw-toast__bar-fill" style={{ width: `${Math.round((t.progress ?? 0) * 100)}%` }} />
            </div>
          </div>
        ) : (
          <div key={t.id} className={`gw-toast${TOAST_CLASS[t.state] ?? ''}`}>
            <span className="gw-toast__dot" />
            <span>
              {t.title}
              {t.message ? (
                <>
                  {' '}
                  <b>{t.message}</b>
                </>
              ) : null}
            </span>
          </div>
        )
      )}
    </div>
  )
}
