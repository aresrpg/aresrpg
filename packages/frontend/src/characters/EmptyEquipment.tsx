// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { AgentKioskPanel } from '../agents/AgentKioskPanel.tsx'
import { useAgentKiosk } from '../agents/useAgentKiosk.ts'
import { copy_text, type AppCopy } from '../i18n/copy.ts'
import { useAppStore } from '../store.ts'
import { available_inventory_items, encumbered_asset_ids } from '../inventory_stacks.ts'

import { InventoryTransferGrid } from './InventoryTransferGrid.tsx'

/** Account inventory and recovery never depend on owning another character. */
export const EmptyEquipment = ({ copy }: Readonly<{ copy: AppCopy }>) => {
  const kiosk = useAgentKiosk(copy, false)
  const inventory = useAppStore((app) => app.session.inventory)
  const listings = useAppStore((app) => app.marketplace.own_listings)
  const trades = useAppStore((app) => app.trade.rows)
  const displayed = available_inventory_items(inventory, encumbered_asset_ids(listings, trades))
  const transferable = available_inventory_items(displayed, kiosk.pending_deposit_ids)
  return (
    <div className="chr-equip chr-equip--empty-agent">
      <div className="chr-equip__bag" data-inventory-owner="player">
        <p className="text-[10px] tracking-[0.2em] text-muted uppercase">
          {copy_text(copy.characters_page)('no_character')}
        </p>
        <InventoryTransferGrid
          owner="player"
          rows={displayed.map((item) => ({
            item,
            status: kiosk.pending_deposit_ids.has(item.id) ? ('listed' as const) : ('available' as const),
            exclusive: kiosk.pending_deposit_ids.has(item.id),
          }))}
          incoming={kiosk.player_pending}
          pending_ids={kiosk.pending_deposit_ids}
          copy={copy}
          disabled={kiosk.busy || kiosk.blocked}
          transfer={(ids, point) => {
            if (!document.elementFromPoint(point.x, point.y)?.closest('[data-inventory-owner="agent"]')) return false
            kiosk.offer(ids, 'deposit', transferable)
            return true
          }}
        />
      </div>
      <AgentKioskPanel kiosk={kiosk} copy={copy} disabled={false} offline={false} />
    </div>
  )
}
