// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The legacy fight nametag, fed by exact disposable runs through the current fight resolver.

import type { EntityScreenAnchor } from '@aresrpg/engine'
import type { SpellTargetPreview } from '@aresrpg/fight'

import './fight_target_previews.css'

export type FightTargetPreviewView = SpellTargetPreview &
  Readonly<{
    allied: boolean
    entity_id: string
    level: bigint
    name: string
  }>

const delta = (before: bigint, after: bigint): string | null => {
  const difference = after - before
  if (difference === 0n) return null
  return `${difference > 0n ? '+' : '−'}${difference < 0n ? -difference : difference}`
}

export const FightTargetPreviews = ({
  anchors,
  critical,
  targets,
}: Readonly<{
  anchors: Readonly<Record<string, EntityScreenAnchor>>
  critical: boolean
  targets: readonly FightTargetPreviewView[]
}>) => (
  <>
    {targets.flatMap((target) => {
      const anchor = anchors[target.entity_id]
      if (!anchor) return []
      const hp_delta = delta(target.hp_before, target.hp_after)
      return [
        <div
          className={`ent-tt ${target.allied ? 'ally' : 'enemy'}`}
          key={target.entity_id}
          style={{ left: anchor.x, top: anchor.y }}
        >
          <div className="ent-tt__head">
            <span aria-hidden="true" className="ent-tt__dot" />
            <span className="ent-tt__name">{target.name}</span>
            <span className="ent-tt__level">LV {target.level.toString()}</span>
            <span className="ent-tt__hp-paren">
              ({target.hp_before}
              {hp_delta && (
                <span
                  className={`ent-tt__delta ${target.hp_after < target.hp_before ? 'ent-tt__delta--dmg' : 'ent-tt__delta--heal'}${critical ? ' ent-tt__delta--crit' : ''}`}
                >
                  {' '}
                  {hp_delta}
                </span>
              )}
              )
            </span>
          </div>
        </div>,
      ]
    })}
  </>
)
