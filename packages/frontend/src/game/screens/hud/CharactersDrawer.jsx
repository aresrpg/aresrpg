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

import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { xp_progress } from '@aresrpg/sdk/experience'

import { use_auth, is_zklogin_session } from '../../../auth'
import { use_game_state, context } from '../../store.js'
import { get_class } from '../../data/classes.js'
import { color_to_hue } from '../../data/color.js'
import { CharacterPortrait } from './CharacterPortrait.jsx'
import { PendingOutcomeBadge } from './PendingOutcomeBadge.jsx'
import {
  character_create,
  read_allowed_classes,
  is_paid_create,
  ADDITIONAL_CHARACTER_PRICE_SUI,
} from '../character-create.js'
import { get_sui_balance } from '../../core/wallet.js'
import { logout } from '../../core/wallet.js'
import { set_pref_zklogin } from '../../core/draft.js'
import { ExplorerLink } from '../../../components/explorer_link.jsx'
import { Tooltip } from './Tooltip.jsx'
import { switch_active_character } from './character_switch.js'
import { report_error } from '../../../core/report.js'
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
import { use_expedition } from '../../../roster/store'
// BACKLOG 18 — chain-direct character DELETE: allowed once everything is unequipped, even the
// free starter. The action composes the SDK's one-call in-kiosk burn door; the guards live ON-CHAIN and the
// receipt folds through the sui_reduce pipeline (tombstoned). The confirm card names the character and uses
// the same explicit irrecoverability acknowledgement as the item-send review.
import { CharacterDeleteConfirm } from './CharacterDeleteConfirm.jsx'
import { CharacterDeleteAction } from './CharacterDeleteAction.jsx'
import { delete_character_onchain } from '../character-delete.js'
import { delete_block_reason } from '../character-delete.gate.js'
import { use_toast } from '../../../toast'

// Which chain this build talks to (matching explorer_link.jsx / handshake.js) — drives the
// unpublished-door delete gate: the pin map is per-network, so the gate must read the LIVE one.
const NETWORK = import.meta.env.VITE_NETWORK || 'testnet'

// Create — WIRED: the paid SDK entry create_character_paid_ptb
// exists. The in-drawer affordance mounts the SAME proven creator (character_create) and ROUTES its submit by
// the shared is_paid_create predicate: first character (count 0, free slot unclaimed) → the FREE
// zkLogin mint; anything else → use_expedition.create_character_paid — SELF-PAY through the S-54 tx choke
// (dry-run refuse → zero gas on an insufficient wallet), the LIVE gate price on the confirm button. (Was HIDDEN
// 2026-07-05 while the drawer's create path was a dead stub that refreshed + closed without minting — a lying
// affordance; the real first-char create lived in CharacterMenu. Now this path mints.)
const ADDITIONAL_CREATE_WIRED = true

// Presentation hex (#rrggbb) → on-chain u32 (character_new packs color_1/2/3 as u32), mirroring ExpeditionCreate /
// CharacterMenu so every create surface sends the identical value.
const color_to_number = (/** @type {string} */ hex) => parseInt(String(hex).replace(/^#/, ''), 16)

import './characters-drawer.css'
import { game_log } from '../../../core/log.js'

/**
 * The inline create flow — mounts the proven vanilla character_create() inside a React host so the
 * drawer reuses it verbatim (same paid-mint hint and on-chain mint PTB). On a
 * successful mint the suiEvent → sui_data refetch repaints the roster; we close back to the list.
 * The three picked colors (Skin/Armor/Trim = on-chain color_1/2/3) flow straight to the mint PTB.
 * `variant` decides the shared creator's FRAME — the create-character page from the characters
 * page must not be a second fullscreen sibling: the wide companion `page`
 * embeds it inline, bounded to `.chr-create-host` (the same `.cc.cc--inline` mechanism the onboarding
 * world-slot host already proves — character-create.placement.test.jsx); the narrow in-world `drawer`
 * keeps the centered overlay modal (no room there to embed the 1040px panel).
 * @param {{ character_count: number, claimed_free: boolean, price_sui: number, on_close: () => void, variant: 'drawer' | 'page' }} props
 */
function CreateHost({ character_count, claimed_free, price_sui, on_close, variant }) {
  const host = useRef(/** @type {HTMLDivElement | null} */ (null))
  useEffect(() => {
    const mount = host.current
    if (!mount) return undefined
    // The shared PAID discriminator (single home in character-create.js) drives the balance hint and the
    // free-vs-paid PTB route below, the same rule the creator's price button renders from.
    // #443: folds in the wallet-session case (money law #73 — a connected wallet never rides the
    // sponsor), so a wallet's FIRST character here correctly routes to create_character_paid too.
    const zklogin_session = is_zklogin_session()
    const paid = is_paid_create({ character_count, claimed_free, zklogin_session })
    /** @type {ReturnType<typeof character_create> | undefined} */ let handle
    let destroyed = false
    // S-84: gate the class grid on the LIVE on-chain Creation whitelist (un-whitelisted → disabled "coming soon";
    // a read hiccup → undefined → all selectable, and the mint-time abort 103 still reads "This class is coming soon").
    void read_allowed_classes().then((allowed_classes) => {
      if (destroyed) return
      handle = character_create({
        character_count,
        claimed_free,
        zklogin_session,
        price_sui,
        allowed_classes,
        placement: variant === 'page' ? 'inline' : 'overlay',
        get_balance_sui: get_sui_balance,
        // D9 LAW — the CLICK-INSTANT prediction: ghost the new character into the engine roster the moment
        // the mint is submitted (the drawer row + downstream consumers see it immediately); the confirmed
        // mint's load_roster REPLACES the roster wholesale (ghost self-heals away), a failure rolls it back.
        on_submit_start: ({ name, class_id, colors: [c1, c2, c3] }) => {
          // M5: the ghost is a receipt_patch delta — the reducer replaces any prior ghost + appends this one
          // against the LATEST roster (no read-modify-write racing a background load_roster snapshot).
          context.dispatch('action/sui_data', {
            kind: 'receipt_patch',
            op: 'set_ghost',
            ghost: {
              id: `ghost:${name}`,
              name,
              classe: class_id,
              color_1: c1,
              color_2: c2,
              color_3: c3,
              level: 1,
              ghost: true,
            },
          })
        },
        on_submit_fail: () => {
          context.dispatch('action/sui_data', { kind: 'receipt_patch', op: 'clear_ghosts' })
        },
        on_created: async ({ name, class_id, male, color_1, color_2, color_3 }) => {
          // ROUTE BY THE SHARED PREDICATE: the second character for zklogin is still 10 sui — swap free
          // for 10 sui and write it on the button too. FIRST character (paid=false) → the
          // proven FREE zkLogin mint (create_character → create_character_free_ptb, sponsor/self-pay
          // money-routed) — the drawer previously sent even a fresh roster-0 account to the PAID builder,
          // charging 10 SUI for the character its own button promised free. ADDITIONAL character
          // (paid=true) → create_character_paid: the SDK's create_character_paid_ptb at the LIVE gate
          // price, SELF-PAY through the S-54 tx choke (dry-run refuse → zero gas on an insufficient
          // wallet), roster repainted by its load_roster. Same predicate as the creator's price button, so
          // the label and the submitted PTB can never disagree. THROWS on failure → surfaced inline by
          // character_create's submit(). On success, close back to the repainted list.
          const draft = {
            name,
            classe: class_id,
            male: male ?? true,
            color_1: color_to_number(color_1),
            color_2: color_to_number(color_2),
            color_3: color_to_number(color_3),
          }
          const { create_character, create_character_paid } = use_expedition.getState()
          await (paid ? create_character_paid(draft) : create_character(draft))
          on_close()
        },
        on_cancel: on_close,
      })
      mount.appendChild(handle.root)
    })
    return () => {
      destroyed = true
      handle?.destroy()
    }
    // character_count is captured once at open — the create flow doesn't react to roster changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return <div className="chr-create-host" ref={host} />
}

/**
 * One character row — portrait + identity + level + xp bar + switch/active + delete. The delete is BLOCKED
 * (disabled + explained) when `delete_block` is a reason string: never delete the character you
 * are playing, never delete one with equipped items.
 * @param {{
 *   character: any, active: boolean, busy: boolean, delete_block: string | null,
 *   on_switch: () => void, on_delete: () => void
 * }} props
 */
function CharacterRow({ character, active, busy, delete_block, on_switch, on_delete }) {
  const { t } = useTranslation()
  const cls = get_class(character.classe ?? character.class_id)
  const { level, into: xp_into, span: xp_span, pct } = xp_progress(character.experience)
  const percent = Math.round(pct)
  const hue = color_to_hue(character.color_1 ?? 0)
  return (
    <div
      className={`chr-row${active ? ' is-active' : ''}`}
      style={/** @type {import('react').CSSProperties} */ ({ '--hue': `${hue}` })}
    >
      <div className="chr-row__art">
        <CharacterPortrait sprites={cls?.sprites ?? '/sprites/senshi'} hue={hue} size={58} />
      </div>
      <div className="chr-row__body">
        <div className="chr-row__head">
          <span className="chr-row__name">{character.name}</span>
          <span className="chr-row__lvl hud-num">Lv {level}</span>
        </div>
        <div className="chr-row__class">{cls?.name ?? character.classe}</div>
        <div className="chr-bar">
          <div className="chr-bar__fill" style={{ width: `${percent}%` }} />
        </div>
        <div className="chr-row__xp hud-num">
          {xp_into.toLocaleString()} / {xp_span.toLocaleString()} xp
        </div>
        {/* D39: character's on-chain object on the block explorer (Character id is stable even when escrowed). */}
        <ExplorerLink object_id={character.id} className="mt-1" />
        {/* P0 anti-brick: an unopened terminal fight (forfeit/partial-settle) shows the OPEN recovery CTA here. */}
        <PendingOutcomeBadge character_id={character.id} />
      </div>
      <div className="chr-row__actions">
        {character.exploring ? (
          // status 2 = DEAD run — escrowed but over; needs a withdraw to recover → distinct red "Fallen"
          // badge. 0/1 (ACTIVE/RETURNING — alive, out on a run) keep the cyan "Exploring" marker.
          character.status === 2 ? (
            <span className="chr-row__fallen">Fallen · recover</span>
          ) : (
            <span className="chr-row__exploring">Exploring</span>
          )
        ) : null}
        {/* T58: MANAGEMENT-only — no "Playing" badge, no Play/deploy/enter button here (the roster + play
            live in the Exploration tab; duplicating caused double-launch thrash). Only the informational
            exploring/Fallen status + delete remain. */}
        <Tooltip text={delete_block ?? t('characters.delete.title', 'Delete character')}>
          <button
            type="button"
            className="chr-row__del"
            aria-label={delete_block ?? t('characters.delete.title', 'Delete character')}
            disabled={busy || delete_block != null}
            onClick={on_delete}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
            </svg>
          </button>
        </Tooltip>
      </div>
      {delete_block && <div className="chr-row__del-note">{delete_block}</div>}
    </div>
  )
}

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
 * One roster entry for the page master-detail list (T58 — MANAGEMENT-only): mini-portrait + identity.
 * Clicking the row previews the character in the detail panel so you can MANAGE it
 * (equipment / stats / jobs / craft). Play + deploy are NOT here — that roster lives in the Exploration
 * tab; duplicating it caused double-launch thrash. The exploring/Fallen badges stay as INFORMATIONAL
 * status (a character escrowed on an expedition is out of the kiosk). Active = the previewed/selected
 * character (gold tint).
 * BACKLOG 18: the ACTIVE (selected) row carries the delete affordance inline — management lives HERE
 * (delete characters from the characters tab), disabled with the honest reason while blocked.
 * Design ruling (2026-07-18): the roster row is avatar + name + level/class ONLY — the HP/AP/MP chips are GONE
 * (they took half the landscape screen; that data lives in the detail pane's STATS tab, its one home).
 * @param {{ character: any, active: boolean, busy: boolean, delete_block: string | null, on_preview: () => void, on_delete: () => void }} props
 */
function RosterEntry({ character, active, busy, delete_block, on_preview, on_delete }) {
  const cls = get_class(character.classe ?? character.class_id)
  const { level } = xp_progress(character.experience)
  const hue = color_to_hue(character.color_1 ?? 0)
  const class_name = (cls?.name ?? character.classe ?? '').toUpperCase()
  // The roster is a list of COMPACT one-line cards: art | name + level·class | status/delete. Clicking a
  // card previews it in the detail panel; the active card only gains an inline delete icon (no second row).
  return (
    <div
      className={`chrx-row${active ? ' is-active' : ''}`}
      style={/** @type {import('react').CSSProperties} */ ({ '--hue': `${hue}` })}
    >
      <div className="chrx-row__main" onClick={on_preview}>
        <div className="chrx-row__art">
          <CharacterPortrait sprites={cls?.sprites ?? '/sprites/senshi'} hue={hue} size={30} />
        </div>
        <div className="chrx-row__id">
          <span className="chrx-row__name">{character.name}</span>
          <span className="chrx-row__sub hud-num">
            Lv {level} <span className="chrx-row__dot">·</span> <span className="chrx-row__cls">{class_name}</span>
          </span>
        </div>
        {/* Right column: informational status (the Exploration tab owns run actions) + the active row's
            inline delete. 2 = DEAD on-chain status → red "Fallen" (needs a withdraw); 0/1 keep cyan
            "Exploring". Kept on one tight line so the row never grows a second row. */}
        <div className="chrx-row__aside">
          {character.exploring &&
            (character.status === 2 ? (
              <div className="chrx-fallen" aria-label="Fallen">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                  <line x1="12" x2="12" y1="9" y2="13" />
                  <line x1="12" x2="12.01" y1="17" y2="17" />
                </svg>
                Fallen
              </div>
            ) : (
              <div className="chrx-exploring" aria-label="Exploring">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                  <circle cx="12" cy="12" r="9" />
                  <path d="m16 8-2 6-6 2 2-6 6-2z" />
                </svg>
                Exploring{character.journey_len ? ` · ${character.opened}/${character.journey_len}` : ''}
              </div>
            ))}
          {/* BACKLOG 18 — delete lives on the active row; stopPropagation so its click never previews. */}
          {active && (
            <CharacterDeleteAction block_reason={delete_block} busy={busy} on_delete={on_delete} />
          )}
        </div>
      </div>
      {/* P0 anti-brick: sibling of the clickable main (its own click never triggers preview) — the OPEN
          recovery CTA for a character stranded with an unopened terminal fight. Renders null when clean. */}
      <PendingOutcomeBadge character_id={character.id} />
    </div>
  )
}

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
  const characters = use_game_state((s) => s.sui.characters)
  const selected_id = use_game_state((s) => s.selected_character_id)
  const loaded = use_game_state((s) => s.sui.loaded)
  // Account-level create routing inputs (the roster/session payload): the on-chain free-character claim
  // marker (the C2 fix; the client cannot infer it from the count) and the LIVE additional-character
  // price. Fed to the create flow + the create-button copy so neither promises FREE to a claimed account.
  const claimed_free = use_game_state((s) => s.sui.has_claimed_free_character)
  const price_sui = use_game_state((s) => s.sui.character_price_sui) ?? ADDITIONAL_CHARACTER_PRICE_SUI
  // Live wallet balance in MIST (single auth-store home). Drives the D50 broke-gate so a paid create that
  // can't afford the mint never attempts the tx — so refetch FRESH on drawer mount (trigger c)
  // rather than trusting a possibly-stale figure.
  const balance_mist = use_auth((s) => s.sui_balance_mist)
  useEffect(() => void use_auth.getState().refresh_sui_balance(), [])
  // The terminal error reason when the read-model never resolved (connect/fetch failed or timed out). With
  // it set + not yet loaded, the roster shows an error + Retry instead of an endless "Loading…" spinner —
  // the boot-routing 3-states law (unfetched ≠ confirmed-empty ≠ populated ≠ error). null = no error.
  const load_error = use_game_state((s) => s.sui.load_error)
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
    delete_block_reason(character, { network: NETWORK, in_world, selected_id })

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
            <CharacterRow
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
