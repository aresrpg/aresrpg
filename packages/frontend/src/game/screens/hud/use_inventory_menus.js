// Bag right-click menus (pet / crush / lootbox) + the equipped-slot context menu + the box-open reveal
// overlay — grouped state and handlers extracted from Inventory.jsx (mechanical file-size split, the
// 600-LoC cap; behavior byte-identical). `t`/`slugs` and the shared retry-guard rerender trigger are
// threaded in from the caller, which still owns the rest of the render.

import { useState } from 'react'

import { ITEM_CATEGORY } from '@aresrpg/sdk/items'

import { is_lootbox } from '../../../world-shell/lootbox_actions.js'
import { use_toast } from '../../../toast'
import { inventory_item_icon, is_item_listed } from './inventory-equip.js'
import { use_escape_close } from './use_escape_close.js'
import { allow_box_retry, block_box_retry } from './lootbox-retry-guard.js'

export function use_inventory_menus({ t, slugs, refresh_retry_guard }) {
  const [pet_menu, set_pet_menu] = useState(/** @type {{ x: number, y: number, pet: any } | null} */ (null))
  const [feed_modal, set_feed_modal] = useState(/** @type {{ pet: any, all: boolean } | null} */ (null))
  const [crush_menu, set_crush_menu] = useState(/** @type {{ x: number, y: number, item: any } | null} */ (null))
  const [crush_confirm, set_crush_confirm] = useState(/** @type {any} */ (null))
  const [box_menu, set_box_menu] = useState(/** @type {{ x: number, y: number, box: any } | null} */ (null))
  const [reveal_box, set_reveal_box] = useState(/** @type {any} */ (null))
  // Right-click on an EQUIPPED paper-doll/cosmetic slot (previously fell through to the native
  // browser menu). EquipMenu owns its own outside-click/Escape dismiss (mirrors CrushMenu), so — unlike
  // pet_menu/box_menu below — this state needs no use_escape_close wiring here.
  const [equip_menu, set_equip_menu] = useState(/** @type {{ x: number, y: number, item: any } | null} */ (null))
  use_escape_close(pet_menu, () => set_pet_menu(null))
  use_escape_close(box_menu, () => set_box_menu(null))

  /** The reveal renders the box art itself — recover the ICON slug through the SAME resolve the bag cell
   * paints with (raw `/v1` item_type is not always the icon key), so the overlay can never fall to a glyph
   * while the bag shows real art. */
  const to_reveal_box = (b) => ({ ...b, icon_slug: inventory_item_icon(b, slugs) })

  const on_grid_context_menu = (event, item) => {
    if (is_item_listed(item)) {
      event.preventDefault()
      use_toast.getState().add(t('errors.item_listed_for_sale'), 'info')
      return
    }
    // NOTE: unlike on_grid_activate, a retry-blocked box still opens ITS menu here (never the whole native
    // fallback) — CRUSH is a DIFFERENT door (forgemagie::crush, no relation to loot_box::open_box) and must stay
    // reachable as the disposal path while OPEN is latched. box_menu itself disables only the OPEN button.
    if (item.item_category === ITEM_CATEGORY.PET) {
      event.preventDefault()
      set_pet_menu({ x: event.clientX, y: event.clientY, pet: item })
    } else if (is_lootbox(item.item_type)) {
      event.preventDefault()
      set_box_menu({ x: event.clientX, y: event.clientY, box: to_reveal_box(item) })
    } else {
      // Let CrushMenu own eligibility. Non-crushable selections get a disabled action + visible reason instead
      // of falling through to a native context menu that looks like the click did nothing.
      event.preventDefault()
      set_crush_menu({ x: event.clientX, y: event.clientY, item })
    }
  }

  const on_box_retry_blocked = (box_id) => {
    block_box_retry(box_id)
    refresh_retry_guard((version) => version + 1)
    set_box_menu(null)
  }

  const on_box_retry_allowed = (box_id) => {
    allow_box_retry(box_id)
    refresh_retry_guard((version) => version + 1)
  }

  return {
    pet_menu,
    set_pet_menu,
    feed_modal,
    set_feed_modal,
    crush_menu,
    set_crush_menu,
    crush_confirm,
    set_crush_confirm,
    box_menu,
    set_box_menu,
    reveal_box,
    set_reveal_box,
    equip_menu,
    set_equip_menu,
    to_reveal_box,
    on_grid_context_menu,
    on_box_retry_blocked,
    on_box_retry_allowed,
  }
}
