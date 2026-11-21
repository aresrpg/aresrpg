// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { useState } from 'react'
import { Button, GameWindow, NativeModal } from '@aresrpg/ui'

import type { AppCopy } from '../i18n/copy.ts'
import type { Locale } from '../i18n/locale.ts'
import { mob_icon } from '../content/assets.ts'
import { content_catalog, titleize, type MobDetail, type SeedMob } from '../content/catalog.ts'
import { encyclopedia_text } from '../encyclopedia/copy.ts'
import { MobDetailsDialog } from '../game/hud/MobDetailsDialog.tsx'

import { dapp_text } from './copy.ts'
import { DappItemRow, DappItemSheet } from './DappItemSheet.tsx'
import { dungeon_rooms } from './places.ts'

import './dapp_parts.css'

/** What a drops sheet is about. A place is named by the caller, with the monsters that live in it. */
export type DropsSubject = Readonly<
  | { kind: 'monster'; mob_type: string }
  | { kind: 'place'; place: string; mob_types: readonly string[] }
  | { kind: 'dungeon'; dungeon: string }
>
/** A monster or an item opened from a list of drops. One is open at a time, over the list. */
type Opened = Readonly<{ kind: 'monster'; mob: SeedMob } | { kind: 'item'; item_type: string }>
type Open = (opened: Opened) => void

const quantity = (min: number, max: number): string => (min === max ? `×${min}` : `×${min}–${max}`)
const known_mobs = (mob_types: readonly string[]): readonly MobDetail[] =>
  [...new Set(mob_types)].flatMap((mob_type) => content_catalog.mob(mob_type) ?? [])

type Shared = Readonly<{ copy: AppCopy; locale: Locale; open: Open }>
/** One monster and everything it drops. The rate is the seed's base rate, so it reads "about". */
const MobDrops = ({ copy, locale, open, detail: { mob, loot } }: Shared & Readonly<{ detail: MobDetail }>) => {
  const icon = mob_icon(mob.mob_type)
  return (
    <section className="dapp-drops-mob" data-mob={mob.mob_type}>
      <Button className="dapp-drops-mob-head" onClick={() => open({ kind: 'monster', mob })}>
        {icon && <img src={icon} alt="" />}
        <span>
          {mob.name}
          <small>{encyclopedia_text(copy)('level_range', { min: mob.level_min, max: mob.level_max })}</small>
        </span>
      </Button>
      <ul className="dapp-rows">
        {loot.map(({ drop }) => (
          <li key={drop.item_type}>
            <DappItemRow
              item_type={drop.item_type}
              detail={quantity(drop.min_qty, drop.max_qty)}
              value={dapp_text(copy, 'drops_rate', {
                rate: (drop.chance_bp / 100).toLocaleString(locale, { maximumFractionDigits: 2 }),
              })}
              open={() => open({ kind: 'item', item_type: drop.item_type })}
            />
          </li>
        ))}
      </ul>
    </section>
  )
}

const MobList = ({ mob_types, ...shared }: Shared & Readonly<{ mob_types: readonly string[] }>) =>
  known_mobs(mob_types).map((detail) => <MobDrops key={detail.mob.mob_type} {...shared} detail={detail} />)

/** A dungeon is read room by room, in the order a team meets them; the last room holds the boss. */
const DungeonDrops = ({ dungeon, ...shared }: Shared & Readonly<{ dungeon: string }>) => {
  const seed = content_catalog.dungeon(dungeon)
  return (seed ? dungeon_rooms(seed) : []).map(({ room, boss, mob_types }) => (
    <section key={room} className="dapp-drops-room" data-room={room}>
      <h2>{dapp_text(shared.copy, boss ? 'drops_boss_room' : 'drops_room', { room: String(room) })}</h2>
      <MobList {...shared} mob_types={mob_types} />
    </section>
  ))
}

type Listed = Exclude<DropsSubject, { kind: 'monster' }>
const list_title = (copy: AppCopy, subject: Listed): string =>
  subject.kind === 'place'
    ? dapp_text(copy, 'drops_place_title', { place: titleize(subject.place) })
    : dapp_text(copy, 'drops_dungeon_title', { dungeon: titleize(subject.dungeon) })

/** Every monster of a place or of a dungeon with its drops; a monster or an item opens over the list. */
const DropsList = ({
  copy,
  locale,
  subject,
  close,
}: Readonly<{ copy: AppCopy; locale: Locale; subject: Listed; close: () => void }>) => {
  const [opened, set_opened] = useState<Opened | null>(null)
  const title = list_title(copy, subject)
  const shared: Shared = { copy, locale, open: set_opened }
  const back = () => set_opened(null)
  return (
    <>
      <NativeModal close={close} label={title} className="aui-modal-scrim">
        <GameWindow
          title={title}
          close={close}
          close_label={dapp_text(copy, 'close')}
          className="aui-inspection"
          data-drops-sheet={subject.kind}
        >
          <div className="dapp-sheet-body">
            {subject.kind === 'place' ? (
              <MobList {...shared} mob_types={subject.mob_types} />
            ) : (
              <DungeonDrops {...shared} dungeon={subject.dungeon} />
            )}
          </div>
        </GameWindow>
      </NativeModal>
      {opened?.kind === 'monster' && <MobDetailsDialog mob={opened.mob} copy={copy} close={back} />}
      {opened?.kind === 'item' && (
        <DappItemSheet copy={copy} subject={{ kind: 'type', item_type: opened.item_type }} close={back} />
      )}
    </>
  )
}

/**
 * What drops, and from whom. One monster is the game's own monster window, with its drop table. A
 * place or a dungeon lists every monster of it; each one opens that same window.
 */
export const DappDropsSheet = ({
  copy,
  locale,
  subject,
  close,
}: Readonly<{ copy: AppCopy; locale: Locale; subject: DropsSubject; close: () => void }>) => {
  if (subject.kind !== 'monster') return <DropsList copy={copy} locale={locale} subject={subject} close={close} />
  const mob = content_catalog.mob(subject.mob_type)?.mob
  return mob ? <MobDetailsDialog mob={mob} copy={copy} close={close} /> : null
}
