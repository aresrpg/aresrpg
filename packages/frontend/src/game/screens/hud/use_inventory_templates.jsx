// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { useEffect, useMemo, useRef, useState } from 'react'
import { catalog, pet_food_slugs } from 'virtual:item_catalog'

import { get_template_by_item_type_map, get_template_map } from '../../../chain/read_findables.js'
import { resolve_rolled_stats } from '../../../chain/rolled_stats.js'
import { useOnchainItemTooltip } from '../../../components/entity_display'
import { is_template_removed } from '../../../components/orphan_item'
import { PetFoodHoverRow } from '../../../pages/encyclopedia/pet_food_section'
import { game_log } from '../../../core/log.js'
import {
  live_pet_food_slugs,
  pet_max_stats_by_live_template,
} from '../../../pages/encyclopedia/pet_foods'

import { inventory_item_icon, item_display_level } from './inventory-equip.js'

/** Live template projection + inventory tooltip state. Every ID originates in the current /v1 maps. */
export function useInventoryTemplates(items, slugs) {
  const [template_map, set_template_map] = useState(() => new Map())
  const [template_id_map, set_template_id_map] = useState(() => new Map())
  useEffect(() => {
    let alive = true
    Promise.all([get_template_by_item_type_map(), get_template_map()]).then(([by_type, by_id]) => {
      if (!alive) return
      set_template_map(by_type)
      set_template_id_map(by_id)
    })
    return () => {
      alive = false
    }
  }, [])

  const food_slugs = useMemo(
    () => live_pet_food_slugs(pet_food_slugs, template_map.keys()),
    [template_map]
  )
  const pet_max_stats_by_template_id = useMemo(
    () => pet_max_stats_by_live_template(template_id_map.values(), catalog),
    [template_id_map]
  )
  const { on_mouse_enter, on_mouse_move, on_mouse_leave, tooltip_element } = useOnchainItemTooltip({
    pet_food_row: <PetFoodHoverRow food_slugs={food_slugs} />,
  })
  const [rolled_stats_by_id, set_rolled_stats_by_id] = useState({})
  const active_hover_id_ref = useRef(null)
  const hover_point_ref = useRef({ clientX: 0, clientY: 0 })
  const paint_item_tooltip = (event, item, rolled_stats) => {
    const item_template = template_id_map.get(item.template_id) ?? template_map.get(item.item_type) ?? {}
    on_mouse_enter(event, {
      ...item_template,
      item_type: item.item_type,
      icon_slug: inventory_item_icon(item, slugs),
      level: item_display_level(item, item_template),
      removed: is_template_removed(item, template_map),
      owned: true,
      rolled_stats,
    })
  }
  const on_item_hover = (event, item) => {
    active_hover_id_ref.current = item.id
    hover_point_ref.current = { clientX: event.clientX, clientY: event.clientY }
    paint_item_tooltip(event, item, rolled_stats_by_id[item.id] ?? null)
    if (!item.id) return
    void resolve_rolled_stats(item.id)
      .catch((error) => {
        game_log('inventory', 'hovered item rolled-stat read failed', { item_id: item.id, error })
        return null
      })
      .then((rolled_stats) => {
        set_rolled_stats_by_id((current) => ({ ...current, [item.id]: rolled_stats }))
        if (active_hover_id_ref.current === item.id)
          paint_item_tooltip(hover_point_ref.current, item, rolled_stats)
      })
  }
  const on_item_hover_move = (event) => {
    hover_point_ref.current = { clientX: event.clientX, clientY: event.clientY }
    on_mouse_move(event)
  }
  const [hovered_bag_id, set_hovered_bag_id] = useState(null)
  const dismiss_item_tooltip = () => {
    active_hover_id_ref.current = null
    set_hovered_bag_id(null)
    on_mouse_leave()
  }
  useEffect(() => {
    if (!hovered_bag_id) return
    const bag_rows = Array.isArray(items) ? items : []
    if (!bag_rows.some((item) => item.id === hovered_bag_id)) dismiss_item_tooltip()
  }, [items, hovered_bag_id, on_mouse_leave])

  return {
    template_map,
    template_id_map,
    food_slugs,
    pet_max_stats_by_template_id,
    rolled_stats_by_id,
    set_rolled_stats_by_id,
    on_item_hover,
    on_item_hover_move,
    dismiss_item_tooltip,
    set_hovered_bag_id,
    tooltip_element,
  }
}
