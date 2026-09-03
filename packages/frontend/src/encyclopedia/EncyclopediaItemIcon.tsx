// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { item_icon } from '../content/assets.ts'

export const EncyclopediaItemIcon = ({ item_type, label }: Readonly<{ item_type: string; label: string }>) => {
  const icon = item_icon(item_type)
  return icon ? (
    <img alt="" className="size-8 shrink-0 object-contain" data-encyclopedia-item-icon={item_type} src={icon} />
  ) : (
    <span
      className="grid size-8 shrink-0 place-items-center border border-white/8 bg-white/3 text-[9px] text-[#c8963c]"
      data-encyclopedia-item-icon={item_type}
    >
      {label.slice(0, 1).toUpperCase()}
    </span>
  )
}
