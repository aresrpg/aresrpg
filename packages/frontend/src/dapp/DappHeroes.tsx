// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { lazy, Suspense, useState } from 'react'
import { NativeModal, ProgressBar, SegmentedControl } from '@aresrpg/ui'
import { experience_progress } from '@aresrpg/immutable/experience'
import type { CharacteristicValues } from '@aresrpg/immutable'
import type { CharacterRow, EquippedItem } from '@aresrpg/protocol'

import type { AppCopy } from '../i18n/copy.ts'
import { dispatch_app, useAppStore } from '../store.ts'
import { character_icon, item_icon } from '../content/assets.ts'
import type { CharacterSession } from '../characters/character_session.ts'
import { OwnedItemDetail } from '../components/OwnedItemDetail.tsx'

import { dapp_text } from './copy.ts'
import { direct_free, hero_hosted, selected_hero, type DappState } from './state.ts'

const StatsTab = lazy(() => import('../characters/StatsTab.tsx'))
const SpellsTab = lazy(() => import('../characters/SpellsTab.tsx'))

type HeroStatus = 'fight' | 'dungeon' | 'activity' | 'free'
const hero_status = (state: DappState, hero: Readonly<CharacterRow>): HeroStatus => {
  if (hero.active_fight) return 'fight'
  if (hero.dungeon_run) return 'dungeon'
  return hero_hosted(state, hero.id) ? 'activity' : 'free'
}

/** Advanced mode picks the hero it acts on; Basic acts on the whole team, so its tiles only inform. */
const HeroTile = ({
  copy,
  hero: row,
  selected,
}: Readonly<{ copy: AppCopy; hero: CharacterRow; selected: boolean | null }>) => {
  const status = useAppStore(({ dapp }) => hero_status(dapp, row))
  const progress = experience_progress(Number(row.experience))
  const portrait = character_icon(row.classe, row.sex, {
    color_1: row.color_1,
    color_2: row.color_2,
    color_3: row.color_3,
  })
  const body = (
    <>
      {portrait ? <img src={portrait} alt="" /> : <span className="dapp-hero-fallback" aria-hidden="true" />}
      <span className="dapp-hero-text">
        <strong>{row.name}</strong>
        <span>{dapp_text(copy, 'hero_level', { level: String(row.level) })}</span>
        <ProgressBar label={dapp_text(copy, 'hero_xp')} value={progress.percent} max={100} />
        <span className="dapp-hero-status">{dapp_text(copy, `status_${status}`)}</span>
      </span>
    </>
  )
  if (selected === null)
    return (
      <div className="dapp-hero" data-status={status}>
        {body}
      </div>
    )
  return (
    <button
      type="button"
      className="dapp-hero"
      aria-pressed={selected}
      data-status={status}
      onClick={() => dispatch_app({ type: 'dapp/select_hero', hero_id: row.id })}
    >
      {body}
    </button>
  )
}

export const DappHeroes = ({ copy }: Readonly<{ copy: AppCopy }>) => {
  const heroes = useAppStore(({ session }) => session.agent_inventory.characters)
  const selected = useAppStore(({ dapp }) => (dapp.mode === 'advanced' ? dapp.hero_id : null))
  return (
    <section className="dapp-section" aria-label={dapp_text(copy, 'heroes_title')}>
      <h2>{dapp_text(copy, 'heroes_title')}</h2>
      <div className="dapp-heroes">
        {heroes.map((hero) => (
          <HeroTile key={hero.id} copy={copy} hero={hero} selected={selected === null ? null : hero.id === selected} />
        ))}
      </div>
    </section>
  )
}

/** The game's own character tabs, fed by the hosted hero and writing through the bot's direct commands. */
const hero_session = (
  hero: Readonly<CharacterRow>,
  items: CharacterSession['inventory'],
  editable: boolean
): CharacterSession => {
  const send = (action: 'raise_stats' | 'raise_spell', payload: Readonly<Record<string, unknown>>) =>
    dispatch_app({ type: 'dapp/hero_action', id: crypto.randomUUID(), hero_id: hero.id, action, payload })
  return {
    inventory: items,
    commit: () => undefined,
    raise_stats: (spending: CharacteristicValues) => send('raise_stats', { character_id: hero.id, spending }),
    ...(editable ? { raise_spell: (spell: string) => send('raise_spell', { character_id: hero.id, spell }) } : {}),
  }
}

const Equipment = ({ copy, items }: Readonly<{ copy: AppCopy; items: readonly EquippedItem[] }>) => {
  const [open, set_open] = useState<EquippedItem | null>(null)
  if (!items.length) return <p className="dapp-note">{dapp_text(copy, 'equipment_empty')}</p>
  return (
    <>
      <ul className="dapp-equipment">
        {items.map((item) => (
          <li key={item.id}>
            <button type="button" className="dapp-item" title={item.name} onClick={() => set_open(item)}>
              {item_icon(item.item_type) ? <img src={item_icon(item.item_type)!} alt={item.name} /> : item.name}
            </button>
          </li>
        ))}
      </ul>
      {open && (
        <NativeModal close={() => set_open(null)} label={open.name} className="aui-modal-scrim">
          <section className="dapp-sheet">
            <OwnedItemDetail item={open} copy={copy} />
          </section>
        </NativeModal>
      )}
    </>
  )
}

/** A stat or spell change needs this hero standing free in its kiosk and no other direct request open. */
const editable_hero = (state: DappState, hero: Readonly<CharacterRow> | null): boolean =>
  [direct_free(state), hero !== null, !hero?.active_fight, !hero?.dungeon_run].every(Boolean)

type DetailTab = 'stats' | 'spells' | 'equipment'
export const DappHeroDetail = ({ copy }: Readonly<{ copy: AppCopy }>) => {
  const hero = useAppStore(({ dapp, session }) => selected_hero(dapp, session.agent_inventory))
  const items = useAppStore(({ session }) => session.agent_inventory.inventory)
  const editable = useAppStore(({ dapp }) => editable_hero(dapp, hero))
  const [tab, set_tab] = useState<DetailTab>('stats')
  if (!hero) return null
  const session = hero_session(hero, items, editable)
  return (
    <section className="dapp-section dapp-detail" aria-label={dapp_text(copy, 'detail_title', { name: hero.name })}>
      <h2>{dapp_text(copy, 'detail_title', { name: hero.name })}</h2>
      {!editable && <p className="dapp-note">{dapp_text(copy, 'detail_locked')}</p>}
      <SegmentedControl<DetailTab>
        label={dapp_text(copy, 'detail_title', { name: hero.name })}
        value={tab}
        on_change={set_tab}
        options={[
          { value: 'stats', label: dapp_text(copy, 'detail_stats') },
          { value: 'spells', label: dapp_text(copy, 'detail_spells') },
          { value: 'equipment', label: dapp_text(copy, 'detail_equipment') },
        ]}
      />
      <Suspense fallback={<p className="dapp-note">{dapp_text(copy, 'loading')}</p>}>
        {/* Without an adapter the game's tab finds no owned character and stays locked. */}
        {tab === 'stats' && (
          <StatsTab character={hero} copy={copy} raise_stats={editable ? session.raise_stats : undefined} />
        )}
        {tab === 'spells' && <SpellsTab character={hero} copy={copy} session={session} />}
        {tab === 'equipment' && <Equipment copy={copy} items={hero.equipment} />}
      </Suspense>
    </section>
  )
}
