// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { Children, type ReactNode } from 'react'

export const empty_action_slot_count = (capacity: number, used_slots: number): number =>
  Math.max(0, capacity - used_slots)

export const ActionSlots = ({
  capacity = 10,
  children,
  columns = 5,
}: Readonly<{ capacity?: number; children?: ReactNode; columns?: number }>) => {
  const actions = Children.toArray(children)
  return (
    <div className="fight-hud__spells" style={{ gridTemplateColumns: `repeat(${columns}, 50px)` }}>
      {actions}
      {Array.from({ length: empty_action_slot_count(capacity, actions.length) }, (_, index) => (
        <div aria-hidden="true" className="fight-hud__spell disabled" data-empty-action-cell="" key={index} />
      ))}
    </div>
  )
}
