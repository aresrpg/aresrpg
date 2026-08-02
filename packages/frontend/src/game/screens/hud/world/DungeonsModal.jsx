// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The world's DUNGEON panel (§9 "the key IS the run"). SPEC §9 collapsed the old registry/browse/create
// model: there is no DungeonRegistry, no "create", no "browse" — a world HAS one dungeon, and you CONSUME A
// KEY to enter it. This modal is now purely the PRE-ENTRY panel: ONE key row + ONE action, or a single
// "you need a key" line. Entry fires the existing create_dungeon_as_leader (dungeon::activate burns one
// locked key → a bound RunPass at room 1); in_session then flips OPTIMISTICALLY (house press law), the modal
// closes, and cave_session mounts the dungeon plane — teleporting you into the first room. Nothing here owns
// the in-run lifecycle (the plane + DungeonBoard + DungeonLeaveButton + NpcPrompt's RESUME do). House DNA:
// near-black glass, gold primary, JetBrains mono, uppercase, sharp.
//
// ZERO-FETCH ON OPEN (regression: the panel should tell the player they lack a key, not fire chain requests
// for 10s): the key COUNT reads from the ALREADY-LOADED engine store (`s.sui.items`) — the SAME source the
// Equipment + Scribe tabs render — filtered to §9 keys (`item_category === 'key'`; one seeded world → every
// held key is THIS dungeon's key). Opening the panel issues NO chain read. The old on-open scan
// (get_sdk → load_world_meta + count_dungeon_keys kiosk-walk + get_template_map) hammered the fullnode for
// ~10s per open and violated the chain-direct-abolition law; it is deleted. The ONLY chain touch is at
// PRESS time, inside create_dungeon_as_leader (it resolves + burns the locked key for the tx) — the exact
// seam the Scribe tab uses on Apply.

import { useEffect } from 'react'
import { useTranslation, Trans } from 'react-i18next'
import { ITEM_CATEGORY } from '@aresrpg/sdk/items'

import { useGameState, context } from '../../../store.js'
import { use_dungeon } from '../../../../world-shell/dungeon_store.js'
import { T62_WORLDS } from '../../../../chain/deployment'
import { as_one_toast } from '../../../../world-shell/dungeon_actions.js'
import { PreFightAllowanceHint } from '../../../../components/prefight_allowance_hint'
import { EncyclopediaLink } from '../../../../pages/encyclopedia/EncyclopediaLink'
import { ItemIcon } from '../ItemIcon.jsx'

const close = () => context.dispatch('action/dungeons_modal', false)
// THE world (§9: one seeded world, one dungeon). Its label is the world-name SSOT (deployment.ts: the World
// has no on-chain name), so the entry-key is named "Key of the <label>".
const WORLD = T62_WORLDS[0]

/** @returns {import('react').ReactElement | null} */
export function DungeonsModal() {
  const { t } = useTranslation()
  const open = useGameState((s) => s.dungeons_modal)
  // The character the player is embodying in the world — the one that ENTERS. NpcPrompt already routes an
  // in_dungeon char to RESUME and blocks an exploring one, so when THIS panel opens the selected char is
  // enterable; a burn/borrow_val MoveAbort otherwise surfaces as the honest store error below.
  const selected_character_id = useGameState((s) => s.selected_character_id)
  // The wallet's loose items — the SSOT the Equipment/Scribe tabs read (load_roster fills it). No fetch here.
  const items = useGameState((s) => s.sui.items)

  const in_session = use_dungeon((s) => s.in_session)
  const busy = use_dungeon((s) => s.busy)
  const error = use_dungeon((s) => s.error)
  const create_dungeon_as_leader = use_dungeon((s) => s.create_dungeon_as_leader)

  // Esc closes, matching every other companion overlay.
  useEffect(() => {
    if (!open) return
    const on_key = /** @param {KeyboardEvent} e */ (e) => {
      if (e.code === 'Escape') close()
    }
    window.addEventListener('keydown', on_key)
    return () => window.removeEventListener('keydown', on_key)
  }, [open])

  // Auto-close the instant the player COMMITS to entering (in_session flips optimistically, BEFORE the tx
  // chain), so they land straight in the plane — never staring at a console. This is ALSO the RESUME path: a
  // live RunPass keeps in_session true, so re-opening the panel drops you back onto the plane (NpcPrompt owns
  // the RESUME affordance; this modal is pre-entry only and never renders an in-run section).
  useEffect(() => {
    if (open && in_session) close()
  }, [open, in_session])

  if (!open) return null

  // Key units held, summed across any separate stacks (a stackable key Item carries `amount` units). §9 keys
  // are `item_category === 'key'`; with one seeded world every held key opens THIS dungeon.
  const key_items = (Array.isArray(items) ? items : []).filter((i) => i.item_category === ITEM_CATEGORY.KEY)
  const keys = key_items.reduce((n, i) => n + (i.amount > 1 ? i.amount : 1), 0)
  const key_name = t('dungeons.key_name', { world: WORLD.label })
  // A held key carries the CURRENT lineage's live template id. With no held row the link degrades to text;
  // a deployment receipt id would be stale after a republish.
  const key_template_id = key_items[0]?.template_id ?? key_items[0]?.template ?? null

  const can_enter = keys > 0 && !!selected_character_id && !busy
  // ENTER resolves the key AND its kiosk from ONE read (create_dungeon_as_leader → key_candidates +
  // resolve_entry_key, single source), so the burn leg extracts from the kiosk the key actually lives in. The
  // modal no longer threads a
  // kiosk — that second source could diverge from the key pick and list the key against the wrong kiosk
  // (`0x2::kiosk::list` EItemNotFound). `key_items` still drives the count/row display below.
  const on_enter = () =>
    as_one_toast(t('dungeons.action_enter_dungeon'), () => create_dungeon_as_leader(selected_character_id))

  return (
    <div className="gw-dg-backdrop" onClick={close}>
      <div className="gw-dg gw-panel" onClick={(e) => e.stopPropagation()}>
        <header className="gw-dg__head">
          <div>
            <h2 className="gw-dg__title">{t('dungeons.title')}</h2>
            <p className="gw-dg__sub">{t('dungeons.subtitle')}</p>
          </div>
          <button type="button" className="gw-dg__x" aria-label={t('dungeons.close')} onClick={close}>
            ✕
          </button>
        </header>

        <div className="gw-dg__body">
          <div className="gw-dg__empty">
            {keys > 0 ? (
              <>
                {/* THE key row: inline item icon + name + a "×N when >1" amount — the SAME shape
                    the bag/marketplace rows use, reusing ItemIcon's icon→category-glyph degrade. */}
                <div className="gw-dg__key">
                  <span className="gw-dg__key-icon">
                    <ItemIcon
                      item={{ icon: key_items[0]?.item_type, category: ITEM_CATEGORY.KEY }}
                      alt={key_name}
                    />
                  </span>
                  <span className="gw-dg__key-name">
                    <EncyclopediaLink kind="item" id={key_template_id}>
                      {key_name}
                    </EncyclopediaLink>
                  </span>
                  {keys > 1 && <span className="gw-dg__key-amount">×{keys}</span>}
                </div>
                <button type="button" className="gw-dg__cta" disabled={!can_enter} onClick={on_enter}>
                  {busy ? t('dungeons.entering') : t('common.use')}
                </button>
                {/* Non-blocking heads-up if the daily free-gameplay allowance may not cover a full fight
                    (never gates entry — past the allowance the player simply self-pays). */}
                <PreFightAllowanceHint />
              </>
            ) : (
              // No key: ONE honest line, nothing else. The key name inside it is a deep-link to the
              // key's encyclopedia page — Trans keeps the sentence translatable while the <link>
              // slot wraps the interpolated key name; an unknown key id degrades the slot to plain text.
              <span className="gw-dg__empty-h">
                <Trans
                  i18nKey="dungeons.need_key"
                  values={{ key: key_name }}
                  components={{ link: <EncyclopediaLink kind="item" id={key_template_id} /> }}
                />
              </span>
            )}
            {error && <span className="gw-dg__error">{error}</span>}
          </div>
        </div>
      </div>
    </div>
  )
}
