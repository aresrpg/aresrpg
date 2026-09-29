// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { useState } from 'react'
import { Button, GameWindow, MobDetails, NativeModal, vital_art, type StatView } from '@aresrpg/ui'
import { Shield } from 'lucide-react'

import {
  content_catalog,
  centered_resistance,
  type SeedMob,
  type SeedItem,
  type LootRow,
} from '../../content/catalog.ts'
import { item_icon, mob_icon } from '../../content/assets.ts'
import { ItemDetailView } from '../../components/ItemDetailView.tsx'
import { MobCoreStats } from '../../components/MobCoreStats.tsx'
import { SpellCard } from '../../encyclopedia/SpellCard.tsx'
import { encyclopedia_text } from '../../encyclopedia/copy.ts'
import { copy_text, type AppCopy } from '../../i18n/copy.ts'
import { useNumbers } from '../../i18n/useNumbers.ts'
import { element_colors } from '../../visual_identity.ts'

export type ItemLookup = (item_type: string) => Readonly<SeedItem> | undefined
export const catalog_item: ItemLookup = (id) => content_catalog.item(id)?.item

export type MobLookup = (mob_type: string) => Readonly<SeedMob> | undefined
export const catalog_mob: MobLookup = (mob_type) => content_catalog.mob(mob_type)?.mob

type Selection = Readonly<
  | { kind: 'spell'; spell: SeedMob['spells'][number] }
  | { kind: 'drop'; drop: LootRow }
  | { kind: 'stat'; label: string; value: string }
>

const DropDetail = ({
  item,
  drop,
  copy,
}: Readonly<{ item: Readonly<SeedItem>; drop: Readonly<LootRow>; copy: AppCopy }>) => {
  const text = encyclopedia_text(copy)
  const numbers = useNumbers()
  return (
    <>
      <ItemDetailView
        item_type={item.item_type}
        name={item.name}
        category={item.category}
        level={item.level}
        stats={item.stats}
        damages={item.damages ?? []}
        labels={{
          characteristics: text('characteristics'),
          damages: text('damages'),
          level_short: text('level_short', { level: item.level }),
          range_to: text('range_to'),
        }}
      >
        <div className="aui-drop-facts">
          <span>
            {copy.item_drop_sources.rate}
            <strong>~{numbers.decimal(drop.chance_bp / 100)}%</strong>
          </span>
          <span>
            {copy.item_drop_sources.quantity}
            <strong>{drop.min_qty === drop.max_qty ? drop.min_qty : `${drop.min_qty}–${drop.max_qty}`}</strong>
          </span>
        </div>
      </ItemDetailView>
    </>
  )
}

const Inspection = ({
  mob,
  selection,
  copy,
  close,
  item_for,
}: Readonly<{
  mob: Readonly<SeedMob>
  selection: Selection
  copy: AppCopy
  close: () => void
  item_for: ItemLookup
}>) => {
  const text = encyclopedia_text(copy)
  switch (selection.kind) {
    case 'spell': {
      const { spell } = selection
      return (
        <NativeModal close={close} label={spell.name} className="aui-modal-scrim">
          <GameWindow
            className="aui-inspection aui-inspection--spell"
            title={spell.name}
            close={close}
            close_label={copy.wallet_close}
          >
            <div className="aui-inspection-body">
              <SpellCard show_icon={false} spell={{ ...spell, classe: mob.mob_type }} />
            </div>
          </GameWindow>
        </NativeModal>
      )
    }
    case 'drop': {
      const { drop } = selection
      const item = item_for(drop.item_type)
      if (!item) return null
      return (
        <NativeModal close={close} label={item.name} className="aui-modal-scrim">
          <GameWindow
            className="aui-inspection aui-inspection--drop"
            title={copy.item_drop_sources.title}
            close={close}
            close_label={copy.wallet_close}
          >
            <div className="aui-inspection-body">
              <DropDetail item={item} drop={drop} copy={copy} />
            </div>
          </GameWindow>
        </NativeModal>
      )
    }
    case 'stat':
      return (
        <NativeModal close={close} label={selection.label} className="aui-modal-scrim">
          <GameWindow
            className="aui-inspection aui-inspection--stats"
            title={`${selection.label} · ${selection.value}`}
            close={close}
            close_label={copy.wallet_close}
          >
            <div className="aui-inspection-body">
              <MobCoreStats
                values={mob}
                labels={{
                  agility: text('gameplay.stat_agility'),
                  wisdom: text('gameplay.stat_wisdom'),
                  xp: copy.ui.xp,
                }}
              />
            </div>
          </GameWindow>
        </NativeModal>
      )
  }
}

export const MobDetailsDialog = ({
  mob,
  copy,
  close,
  item_for = catalog_item,
}: Readonly<{ mob: Readonly<SeedMob>; copy: AppCopy; close: () => void; item_for?: ItemLookup }>) => {
  const [selection, set_selection] = useState<Selection | null>(null)
  const text = copy_text(copy.characters_page)
  const stats: readonly StatView[] = [
    { id: 'hp', label: text('stats.health'), value: mob.hp, icon: <img src={vital_art.health} alt="" /> },
    { id: 'ap', label: text('stats.action'), value: mob.ap, icon: <img src={vital_art.action} alt="" /> },
    { id: 'mp', label: text('stats.move'), value: mob.mp, icon: <img src={vital_art.movement} alt="" /> },
  ]
  const inspect_stat = (stat: StatView): StatView => ({
    ...stat,
    on_select: () => set_selection({ kind: 'stat', label: stat.label, value: String(stat.value) }),
  })
  return (
    <>
      <NativeModal close={close} label={mob.name} className="aui-modal-scrim">
        <MobDetails
          title={mob.name}
          subtitle={encyclopedia_text(copy)('level_range', { min: mob.level_min, max: mob.level_max })}
          portrait={<img src={mob_icon(mob.mob_type) ?? undefined} alt="" />}
          vitals={stats.map(inspect_stat)}
          resistances={(['fire', 'water', 'earth', 'air'] as const).map((element) =>
            inspect_stat({
              id: element,
              label: text(`stats.element.${element}`),
              value: `${centered_resistance(mob.resistances[element])}%`,
              icon: (
                <Shield size={20} color={element_colors[element]} fill={element_colors[element]} fillOpacity={0.15} />
              ),
            })
          )}
          actions={<Button onClick={close}>{copy.wallet_close}</Button>}
        >
          <section className="aui-mob-section">
            <h3>{text('tab_spells')}</h3>
            <div className="aui-mob-spells">
              {mob.spells.map((spell) => (
                <Button key={spell.name} onClick={() => set_selection({ kind: 'spell', spell })}>
                  {spell.name}
                </Button>
              ))}
            </div>
          </section>
          <section className="aui-mob-section">
            <h3>{copy.item_drop_sources.title}</h3>
            <div className="aui-mob-loot">
              {mob.loot.map((drop) => (
                <button
                  type="button"
                  key={drop.item_type}
                  aria-label={item_for(drop.item_type)?.name ?? drop.item_type}
                  onClick={() => set_selection({ kind: 'drop', drop })}
                >
                  <img src={item_icon(drop.item_type) ?? undefined} alt="" />
                  <span>~{drop.chance_bp / 100}%</span>
                  <small>×{drop.min_qty === drop.max_qty ? drop.min_qty : `${drop.min_qty}–${drop.max_qty}`}</small>
                </button>
              ))}
            </div>
          </section>
        </MobDetails>
      </NativeModal>
      {selection && (
        <Inspection item_for={item_for} mob={mob} selection={selection} copy={copy} close={() => set_selection(null)} />
      )}
    </>
  )
}
