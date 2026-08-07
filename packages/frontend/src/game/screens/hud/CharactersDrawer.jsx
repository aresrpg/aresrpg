// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Characters right-drawer — the in-world character switcher + creator that REPLACES the old select
// carousel: spawn in-game directly, switch/create from this drawer; the select screen is
// gone. Lists every on-chain character (s.sui.characters, read chain-direct) with class portrait,
// level + xp bar, switch + delete; "New character" mounts the proven vanilla create flow inline (first
// free, additional 10 SUI to treasury@aresrpg — the existing onboarding, untouched). Switching is a
// hot-swap of the active character (no return-to-menu): it dispatches action/select_character (the single
// source of truth — chain-direct, no server), persists last-played (a preference), and tells the world
// shell to re-key the roam cosmetics. Reference: the aresrpg companion characters page (CharacterDetail
// card layout; Bank dropped) + the legacy create flow — restyled to the house Frosted Obsidian.
//
// The create host, narrow drawer row, and page roster entry live in focused sibling files (issue #2069).
// This file remains the composition root: shared state, mutations, and the page/drawer branches.

import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { use_auth, is_zklogin_session } from '../../../auth'
import { useGameState, context } from '../../store.js'
import { is_paid_create, ADDITIONAL_CHARACTER_PRICE_SUI } from '../character-create.js'
import { logout } from '../../core/wallet.js'
import { set_pref_zklogin } from '../../core/draft.js'
import { switch_active_character } from './character_switch.js'
import { report_error } from '../../../core/report.js'
import { CreateHost } from './CharacterCreateHost.jsx'
import { CharacterDrawerRow } from './CharacterDrawerRow.jsx'
import { RosterEntry } from './CharacterRosterEntry.jsx'
// The detail-strip tab bodies REUSE the already-built, store-sourced drawers (no reimplementation):
// EQUIPMENT = the canon-04 Loadout (paper-doll + bag + on-chain drag-drop), STATS = the characteristics
// sheet, JOBS = the jobs/craft drawer. All self-source from `selected_character_id`, so selecting a
// roster row drives every tab. (Spells live in the Spells launcher; this meta-tab is MANAGEMENT-only.)
import { Inventory } from './Inventory.jsx'
import { Stats } from './Stats.jsx'
import { JobsDrawer } from './JobsDrawer.jsx'
import { Spellbook } from './Spellbook.jsx'
// RUNEFORGE: forgemagie is per-character (scribing runes onto the SELECTED
// character's gear) — it moved off the page-level Characters|Runeforge strip into this detail row, scoped
// via the `character_id` prop (the minimal seam; ScribePage does its own kiosk-scoped SDK read off it).
import { ScribePage } from '../../../pages/scribe'
import { CreateBrokeCard } from './CreateBrokeCard.jsx'
// BACKLOG 18 — chain-direct character DELETE: allowed once everything is unequipped, even the
// free starter. The action composes the SDK's one-call in-kiosk burn door; the guards live ON-CHAIN and the
// receipt folds through the sui_reduce pipeline (tombstoned). The confirm card names the character and uses
// the same explicit irrecoverability acknowledgement as the item-send review.
import { CharacterDeleteConfirm } from './CharacterDeleteConfirm.jsx'
import { delete_character_onchain } from '../character-delete.js'
import { delete_block_reason } from '../character-delete.gate.js'
import { use_toast } from '../../../toast'
import { FRONTEND_NETWORK } from '../../../env'

// Which chain this build talks to (matching explorer_link.jsx / handshake.js) — drives the
// unpublished-door delete gate: the pin map is per-network, so the gate must read the LIVE one.
// Create — WIRED: the paid SDK entry create_character_paid_ptb
// exists. The in-drawer affordance mounts the SAME proven creator (character_create) and ROUTES its submit by
// the shared is_paid_create predicate: first character (count 0, free slot unclaimed) → the FREE
// zkLogin mint; anything else → use_expedition.create_character_paid — SELF-PAY through the S-54 tx choke
// (dry-run refuse → zero gas on an insufficient wallet), the LIVE gate price on the confirm button. (Was HIDDEN
// 2026-07-05 while the drawer's create path was a dead stub that refreshed + closed without minting — a lying
// affordance; the real first-char create lived in CharacterMenu. Now this path mints.)
const ADDITIONAL_CREATE_WIRED = true

import './characters-drawer.css'
import { game_log } from '../../../core/log.js'

// The detail-strip tab order (T58, management-only): EQUIPMENT, STATS, SPELLS, JOBS, RUNEFORGE. (INVENTORY
// is folded into EQUIPMENT — the built Loadout is paper-doll + bag in one surface. FIGHTS tab removed —
// board #7 pruned the on-chain `combat` module; gear now counts directly instead.) RUNEFORGE joined this
// row (design ruling 2026-07-10) — forgemagie is per-character, so it rides here instead of a page-level tab.
const DETAIL_TABS = /** @type {const} */ ([
  ['equipment', 'Equipment'],
  ['stats', 'Stats'],
  ['spells', 'Spells'],
  ['jobs', 'Jobs'],
  ['runeforge', 'Runeforge'],
])

/**
 * The characters drawer body. Self-sources the roster from the engine store (the on-chain read-model)
 * and the selected id. `on_switch` lets the world shell hot-swap the active roam character without a
 * return-to-menu (App re-keys the scene). When no character is active yet (e.g. opened from the boot
 * confirmed-empty state) it still works — switching simply enters with the chosen one.
 * `variant` selects the layout: `'drawer'` (default) = the narrow in-world HUD right-drawer list;
 * `'page'` = the wide companion meta-tab master-detail (boxed roster list + a borderless detail panel
 * with the EQUIPMENT/STATS/JOBS strip). Same logic + data either way (SSOT, one component).
 * @param {{ on_switch: (character: any) => void, variant?: 'drawer' | 'page' }} props
 */
export function CharactersDrawer({ on_switch, variant = 'drawer' }) {
  const { t } = useTranslation()
  const characters = useGameState((s) => s.sui.characters)
  const selected_id = useGameState((s) => s.selected_character_id)
  const loaded = useGameState((s) => s.sui.loaded)
  // Account-level create routing inputs (the roster/session payload): the on-chain free-character claim
  // marker (the C2 fix; the client cannot infer it from the count) and the LIVE additional-character
  // price. Fed to the create flow + the create-button copy so neither promises FREE to a claimed account.
  const claimed_free = useGameState((s) => s.sui.has_claimed_free_character)
  const price_sui = useGameState((s) => s.sui.character_price_sui) ?? ADDITIONAL_CHARACTER_PRICE_SUI
  // Live wallet balance in MIST (single auth-store home). Drives the D50 broke-gate so a paid create that
  // can't afford the mint never attempts the tx — so refetch FRESH on drawer mount (trigger c)
  // rather than trusting a possibly-stale figure.
  const balance_mist = use_auth((s) => s.sui_balance_mist)
  useEffect(() => void use_auth.getState().refresh_sui_balance(), [])
  // The terminal error reason when the read-model never resolved (connect/fetch failed or timed out). With
  // it set + not yet loaded, the roster shows an error + Retry instead of an endless "Loading…" spinner —
  // the boot-routing 3-states law (unfetched ≠ confirmed-empty ≠ populated ≠ error). null = no error.
  const load_error = useGameState((s) => s.sui.load_error)
  const [creating, set_creating] = useState(false)
  const [broke, set_broke] = useState(false)
  const [pending_id, set_pending_id] = useState(/** @type {string | null} */ (null))
  const [confirm_delete, set_confirm_delete] = useState(/** @type {string | null} */ (null))
  const [tab, set_tab] = useState('equipment')

  const roster = useMemo(() => characters ?? [], [characters])
  // No character cap: first is free, additional cost 1 SUI each (no hard limit — tracked in BACKLOG #61).
  const has_room = true

  // D50 — CREATE balance pre-validation. The FIRST character is free/sponsored; only a SELF-PAID create
  // (the shared is_paid_create predicate — the same rule that routes the mint PTB) must clear the wallet
  // check. Gate on price + 0.2 SUI gas headroom; short of it → the broke card, never a doomed mint.
  // #443: a connected WALLET session is always self-pay (money law #73), even for its first character —
  // folded into the same predicate so the broke-gate and every price label below agree with it.
  const paid_create = is_paid_create({ character_count: roster.length, claimed_free, zklogin_session: is_zklogin_session() })
  const BROKE_THRESHOLD_MIST = BigInt(Math.ceil((price_sui + 0.2) * 1e9))
  const request_create = () => {
    if (paid_create && (balance_mist ?? 0n) < BROKE_THRESHOLD_MIST) {
      set_broke(true)
      return
    }
    set_creating(true)
  }
  // Portalled to <body>, so a single element overlays whichever variant is mounted (drawer OR page).
  const broke_card = broke ? (
    <CreateBrokeCard
      price_sui={price_sui}
      balance_mist={balance_mist}
      on_close={() => set_broke(false)}
    />
  ) : null
  const selected = useMemo(
    () => roster.find((character) => character.id === selected_id) ?? null,
    [roster, selected_id]
  )

  // In the page master-detail, the detail panel + every tab body read `selected_character_id`. So if
  // nothing is selected yet (e.g. opened before a character was picked), preview the first character so
  // the sheet is never blank. Local select only (no packet / no navigate) — entering the world is the
  // per-row Enter button. The guard makes this fire once.
  useEffect(() => {
    if (variant !== 'page') return
    if (selected_id == null && roster.length > 0) context.dispatch('action/select_character', roster[0].id)
  }, [variant, selected_id, roster])

  // T82.1: re-selecting the ALREADY-selected character bumps a nonce that re-keys the detail
  // body → its tab drawer remounts fresh → any open Jobs item-detail closes → the collapsed roster rail
  // re-expands. (Switching to a DIFFERENT character already remounts via selected.id.) This lets clicking
  // the thin GLB-icon column uncollapse it, and it works even with a single character.
  const [roster_nonce, set_roster_nonce] = useState(0)
  // Preview a roster character in the detail panel (select it locally; the built tab drawers react).
  const preview = (/** @type {any} */ character) => {
    if (character.id === selected_id) set_roster_nonce((n) => n + 1)
    else context.dispatch('action/select_character', character.id)
  }

  // Hot-swap the active character (no return-to-menu): route through switch_active_character — the SAME
  // seam CharacterSwitcher uses — so selection, persistence, the world session, AND the fight board all
  // re-key together. on_switch (the world-shell handoff) fires only once the rebind actually SUCCEEDED;
  // a failure surfaces the same visible toast CharacterSwitcher shows instead of a silent half-switch.
  const switch_to = (/** @type {any} */ character) => {
    set_pending_id(character.id)
    void switch_active_character(character, (error) => {
      game_log('characters', 'active character switch failed', error)
      report_error(error, { area: 'characters-drawer', action: 'select_character' })
      use_toast.getState().add(t('errors.character_switch_failed'), 'error')
    })
      .then((switched) => {
        if (switched) on_switch(character)
      })
      .finally(() => set_pending_id(null))
  }

  // BACKLOG 18 — the REAL chain-direct delete (replaces the S-50 disabled stub): one toast lifecycle
  // through the S-54 tx choke; the on-chain door re-asserts every guard (unequipped / no unopened fight /
  // no dungeon lock) and any abort reads as honest copy via the ONE decoder. On success the receipt
  // already folded through the roster pipeline (tombstoned) — here we only release the selection if the
  // burned character held it (the page auto-preview repoints to the first survivor).
  const delete_character = async (/** @type {any} */ character) => {
    set_pending_id(character.id)
    try {
      await use_toast.getState().promise(delete_character_onchain(character.id), {
        pending: t('characters.delete.pending', 'Deleting {{name}}…', { name: character.name }),
        success: t('characters.delete.success', '{{name}} was deleted', { name: character.name }),
      })
      if (character.id === selected_id) context.dispatch('action/select_character', null)
      set_confirm_delete(null)
    } catch (error) {
      // the toast already surfaced the decoded copy — keep the confirm open for a cancel/retry decision.
      game_log('characters', 'delete failed', error)
    } finally {
      set_pending_id(null)
    }
  }

  // Delete guards — ONE pure fold (character-delete.js delete_block_reason) shared by both variants:
  // the unpublished-door gate FIRST (the on-chain `character_extract` door ships at a future ceremony;
  // until the CHARACTER_EXTRACT_POLICY pin is stamped for this network, delete disables with the honest
  // "next chain upgrade" reason), then the standing guards (exploring / playing / equipped). The fold
  // reads the live i18n instance; useTranslation already re-renders this component on language change.
  const delete_block_for = (/** @type {any} */ character, in_world = true) =>
    delete_block_reason(character, { network: FRONTEND_NETWORK, in_world, selected_id })

  // The character behind the open confirm card (id-keyed state survives roster repaints), shared by both
  // variant branches below. A vanished character (deleted elsewhere / snapshot) closes the card by rendering
  // nothing.
  const confirm_character = confirm_delete ? (roster.find((c) => c.id === confirm_delete) ?? null) : null
  const confirm_card = confirm_character ? (
    <CharacterDeleteConfirm
      character={confirm_character}
      busy={pending_id != null}
      on_cancel={() => set_confirm_delete(null)}
      on_confirm={() => void delete_character(confirm_character)}
    />
  ) : null

  // Log out: the select screen carried logout, it was removed — restore a clear control. Mirror
  // App's do_logout: clear the Enoki session + the zkLogin preference, then reload to the front-of-game.
  const do_logout = async () => {
    try {
      await logout()
    } catch (error) {
      game_log('characters', 'logout failed', error)
    }
    await set_pref_zklogin(false)
    window.location.reload()
  }

  // The pre-roster placeholder: an error + Retry when the read-model failed/timed out (never a silent
  // perpetual spinner), else the loading affordance. Retry reloads — the boot path re-runs the engine
  // connect (same guaranteed-correct reset as Log out), which re-fetches the roster. Reused by both
  // variants so the 3-states behave identically in the in-world drawer and the meta-tab page.
  const roster_placeholder = load_error ? (
    <div
      className="hud-panel-empty"
      style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-start' }}
    >
      <span>{load_error}</span>
      <button type="button" className="hud-btn" onClick={() => window.location.reload()}>
        Retry
      </button>
    </div>
  ) : (
    <div className="hud-panel-empty">Loading characters…</div>
  )

  if (creating) {
    return (
      <div className="chr">
        <button type="button" className="chr-back" onClick={() => set_creating(false)}>
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="m15 18-6-6 6-6" />
          </svg>
          Back to characters
        </button>
        <CreateHost
          character_count={roster.length}
          claimed_free={claimed_free}
          price_sui={price_sui}
          variant={variant}
          on_close={() => set_creating(false)}
        />
      </div>
    )
  }

  // ── PAGE master-detail (companion meta-tab) ────────────────────────────────────────────────────
  if (variant === 'page') {
    return (
      <div className="chr chr--page">
        <header className="chr-page__head">
          <h1 className="chr-page__title">Characters</h1>
          <span className="chr-page__sub">
            On-chain on Sui · <b className="hud-num">{roster.length}</b>{' '}
            {roster.length === 1 ? 'character' : 'characters'}
          </span>
        </header>
        <div className="chr-md">
          {/* LEFT — the boxed roster list (compact rows + per-row Enter) */}
          <aside className="chr-md__list">
            {/* T80: the character header lives in the narrow left rail (not a full-width top band)
                so the right content panel goes full-width. T82: the header is no longer a
                separate band — it's folded into the EXPANDED active roster card below (compact list, the
                selected card expands to show vitals), killing the duplicate header+card. */}
            <div className="chr-md__list-head">
              <span>Your roster</span>
              <span className="hud-num">{roster.length}</span>
            </div>
            {!loaded ? (
              roster_placeholder
            ) : (
              <div className="chr-md__roster">
                {roster.map((character) => (
                  <RosterEntry
                    key={character.id}
                    character={character}
                    active={character.id === selected_id}
                    busy={pending_id != null}
                    delete_block={delete_block_for(character, false)}
                    on_preview={() => preview(character)}
                    on_delete={() => set_confirm_delete(character.id)}
                  />
                ))}
                {ADDITIONAL_CREATE_WIRED && has_room && (
                  <button type="button" className="chr-md__create" onClick={request_create}>
                    <span className="chr-md__create-plus" aria-hidden="true">
                      +
                    </span>
                    <span className="chr-md__create-label">Create character</span>
                    <span className="chr-md__create-note">
                      {/* #443: paid_create already folds in the wallet-session case (money law #73) — a
                          fresh wallet's first character must never read "First free". */}
                      {paid_create ? `${price_sui} SUI` : `First free · then ${price_sui} SUI`}
                    </span>
                  </button>
                )}
              </div>
            )}
          </aside>

          {/* RIGHT — the borderless detail panel: EQUIPMENT/STATS/SPELLS/JOBS/RUNEFORGE strip */}
          <section className="chr-detail">
            {selected ? (
              <>
                <nav className="chrd-tabs">
                  {DETAIL_TABS.map(([key, label]) => (
                    <button
                      key={key}
                      type="button"
                      className={`chrd-tab${tab === key ? ' is-active' : ''}`}
                      onClick={() => set_tab(key)}
                    >
                      {key === 'runeforge' ? t('scribe.title') : label}
                    </button>
                  ))}
                </nav>
                <div className={`chrd-body chrd-body--${tab}`} key={`${selected.id}:${roster_nonce}`}>
                  {/* tab bodies = the built, store-sourced drawers (reuse, no reimplementation). Keyed by
                      character id (+ a nonce bumped on re-selecting the active char, T82.1) so a roster
                      switch OR an icon re-click remounts them fresh — dropping staged equip/stat edits and
                      closing any open Jobs item-detail (which un-collapses the thin roster rail). RUNEFORGE
                      is scoped to the selected character via `character_id`. */}
                  {tab === 'equipment' && <Inventory />}
                  {tab === 'stats' && <Stats />}
                  {tab === 'spells' && <Spellbook embedded />}
                  {tab === 'jobs' && <JobsDrawer />}
                  {tab === 'runeforge' && <ScribePage character_id={selected.id} />}
                </div>
              </>
            ) : (
              <div className="hud-panel-empty chr-detail__empty">
                {loaded ? 'Select a character to view its sheet' : (load_error ?? 'Loading characters…')}
              </div>
            )}
          </section>
        </div>
        {confirm_card}
        {broke_card}
      </div>
    )
  }

  // ── DRAWER list (narrow in-world HUD right-drawer) ─────────────────────────────────────────────
  return (
    <div className="chr">
      {/* primary actions UP TOP: nothing at the drawer foot where it overlaps the launcher
          dock. New + Log out sit as a clean button row above the roster. */}
      <div className="chr-actions">
        {/* Per the loaded-discriminator law: the create affordance is SPECULATIVE until the read-model lands —
            pre-load roster=[] + claimed_free=false flashed the first-character "Create character" copy at an
            EXISTING lineage, and a click that early would attempt a FREE mint the server rejects (the C2 trap).
            Gate the whole button on `loaded` (Log out stays always-available); the label branch is then honest. */}
        {ADDITIONAL_CREATE_WIRED && has_room && loaded && (
          <button type="button" className="chr-new" onClick={request_create}>
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M12 5v14M5 12h14" />
            </svg>
            {/* #443: paid_create already folds in the wallet-session case (money law #73) — a fresh
                wallet's first character must show its price, never the free-mint copy. */}
            {paid_create ? `New character (${price_sui} SUI)` : 'Create character'}
          </button>
        )}
        <button type="button" className="chr-logout" onClick={() => void do_logout()}>
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
            <polyline points="16 17 21 12 16 7" />
            <line x1="21" x2="9" y1="12" y2="12" />
          </svg>
          Log out
        </button>
      </div>
      {!loaded ? (
        roster_placeholder
      ) : (
        <div className="chr-list">
          {roster.map((character) => (
            <CharacterDrawerRow
              key={character.id}
              character={character}
              active={character.id === selected_id}
              busy={pending_id != null}
              delete_block={delete_block_for(character)}
              on_switch={() => switch_to(character)}
              on_delete={() => set_confirm_delete(character.id)}
            />
          ))}
          {roster.length === 0 && <div className="hud-panel-empty">No characters yet. Create your first one.</div>}
        </div>
      )}

      {confirm_card}
      {broke_card}
    </div>
  )
}
