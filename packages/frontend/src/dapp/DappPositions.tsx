// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { useEffect, useMemo, useState } from 'react'
import { Button, NativeModal, ProgressBar } from '@aresrpg/ui'
import type { ItemRow } from '@aresrpg/protocol'

import type { AppCopy } from '../i18n/copy.ts'
import type { Locale } from '../i18n/locale.ts'
import { dispatch_app, useAppStore } from '../store.ts'
import { item_icon } from '../content/assets.ts'
import { OwnedItemDetail } from '../components/OwnedItemDetail.tsx'
import { titleize } from '../content/catalog.ts'
import { format_sui } from '../wallet_amount.ts'

import { dapp_text, item_name } from './copy.ts'
import { fight_mates, hero_health } from './account.ts'
import type { DappHaul, DappPosition, PositionTotals } from './positions.ts'
import { hero_command } from './state.ts'

/** The loot strip shows twelve item types, then counts the rest (mockup round 9 layout limit). */
const LOOT_STRIP = 12

const useClock = (running: boolean): number => {
  const [now, set_now] = useState(() => Date.now())
  useEffect(() => {
    if (!running) return
    const timer = setInterval(() => set_now(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [running])
  return now
}
const duration = (ms: number): string => {
  const minutes = Math.floor(Math.max(0, ms) / 60_000)
  return minutes >= 60 ? `${Math.floor(minutes / 60)} h ${minutes % 60} min` : `${minutes} min`
}

const Loot = ({ copy, haul }: Readonly<{ copy: AppCopy; haul: DappHaul }>) => {
  const rows = useAppStore(({ session }) => session.agent_inventory.inventory)
  const [open, set_open] = useState<ItemRow | null>(null)
  const found = Object.entries(haul.found)
  if (!found.length) return <p className="dapp-note">{dapp_text(copy, 'position_no_loot')}</p>
  return (
    <>
      <ul className="dapp-loot" aria-label={dapp_text(copy, 'position_loot')}>
        {found.slice(0, LOOT_STRIP).map(([item_type, amount]) => {
          const row = rows.find((candidate) => candidate.item_type === item_type) ?? null
          const name = item_name(item_type)
          const icon = item_icon(item_type)
          return (
            <li key={item_type}>
              <button type="button" className="dapp-item" title={name} disabled={!row} onClick={() => set_open(row)}>
                {icon ? <img src={icon} alt={name} /> : <span>{name}</span>}
                <span className="dapp-item-count">×{amount}</span>
              </button>
            </li>
          )
        })}
        {found.length > LOOT_STRIP && <li className="dapp-loot-more">+{found.length - LOOT_STRIP}</li>}
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

/** The bag and the wallet are shared, so what the heroes found and what the bot paid is told once. */
const Haul = ({ copy, locale }: Readonly<{ copy: AppCopy; locale: Locale }>) => {
  const haul = useAppStore(({ dapp }) => dapp.haul)
  if (!haul) return null
  return (
    <article className="dapp-haul">
      <header>
        <h3>{dapp_text(copy, 'haul_title')}</h3>
        <span title={dapp_text(copy, 'haul_spent_hint')}>
          {dapp_text(copy, 'haul_spent', { amount: format_sui(haul.spent_mist, 4, locale) })}
        </span>
      </header>
      <Loot copy={copy} haul={haul} />
    </article>
  )
}

/** Bot issue codes stay diagnostic; the player reads only whether the bot is working, blocked or done. */
const status_key = (position: DappPosition, stopping: boolean): string => {
  if (position.finished_ms !== null) return position.issue ? 'position_ended_issue' : 'position_finished'
  if (stopping) return 'position_stopping'
  return position.issue ? 'position_waiting' : 'position_running'
}

/** Where the hero is right now, from its own chain row: its health, dungeon room and who shares its fight. */
const Whereabouts = ({ copy, hero_id }: Readonly<{ copy: AppCopy; hero_id: string }>) => {
  const heroes = useAppStore(({ session }) => session.agent_inventory.characters)
  const fights = useAppStore(({ session }) => session.agent_inventory.fights)
  const owner = useAppStore(({ session }) => session.inventory_pairing?.address ?? null)
  const now = useClock(true)
  const hero = heroes.find(({ id }) => id === hero_id)
  // A fighter's health moves with its fight, never with the clock: the fight row is decoded once per push.
  const fighting = useMemo(
    () => (hero?.active_fight ? hero_health(hero, { fights }, owner, 0) : null),
    [hero, fights, owner]
  )
  if (!hero) return null
  const run = hero.dungeon_run
  const hp = hero.active_fight ? fighting : hero_health(hero, { fights }, owner, now)
  const mates = fight_mates(heroes, hero_id)
    .map(({ name }) => name)
    .join(', ')
  return (
    <>
      {hp && (
        <ProgressBar
          label={dapp_text(copy, 'position_hp')}
          value={hp.current}
          max={hp.maximum}
          detail={`${Math.round(hp.current)} / ${Math.round(hp.maximum)}`}
        />
      )}
      {run && (
        <p className="dapp-position-where">
          {dapp_text(copy, 'position_dungeon', { dungeon: titleize(run.dungeon), room: String(run.room) })}
        </p>
      )}
      {mates && <p className="dapp-position-where">{dapp_text(copy, 'position_team', { names: mates })}</p>}
    </>
  )
}

const Facts = ({ copy, locale, totals }: Readonly<{ copy: AppCopy; locale: Locale; totals: PositionTotals }>) => (
  <dl className="dapp-facts">
    <div>
      <dt>{dapp_text(copy, 'position_xp')}</dt>
      <dd>
        +{totals.xp.toLocaleString(locale)}
        {totals.levels > 0 && ` · ${dapp_text(copy, 'position_levels', { count: String(totals.levels) })}`}
      </dd>
    </div>
    <div>
      <dt>{dapp_text(copy, 'position_job_xp')}</dt>
      <dd>+{totals.job_xp.toLocaleString(locale)}</dd>
    </div>
    <div>
      <dt>{dapp_text(copy, 'position_fights')}</dt>
      <dd>{totals.fights.length}</dd>
    </div>
  </dl>
)

/** A running hero shows where it is and one Stop of its own; a finished card stays until dismissed. */
const PositionCard = ({
  copy,
  locale,
  position,
}: Readonly<{ copy: AppCopy; locale: Locale; position: DappPosition }>) => {
  const { hero_id, activity, started_ms, finished_ms } = position
  const hero = useAppStore(
    ({ session }) => session.agent_inventory.characters.find(({ id }) => id === hero_id)?.name ?? ''
  )
  const command = useAppStore(({ dapp }) => hero_command(dapp, hero_id))
  const running = finished_ms === null
  const now = useClock(running)
  const stopping = command?.kind === 'stop'
  return (
    <article className="dapp-position" data-running={running || undefined}>
      <header>
        <h3>
          {dapp_text(copy, `activity_${activity ?? 'other'}`)} · {hero}
        </h3>
        <span className="dapp-position-time">{duration((finished_ms ?? now) - started_ms)}</span>
      </header>
      <p className="dapp-position-status" aria-live="polite">
        {dapp_text(copy, status_key(position, stopping))}
      </p>
      {running && <Whereabouts copy={copy} hero_id={hero_id} />}
      <Facts copy={copy} locale={locale} totals={position.totals} />
      <footer>
        {running ? (
          <Button
            busy={stopping}
            disabled={command !== null}
            onClick={() => dispatch_app({ type: 'dapp/stop', id: crypto.randomUUID(), hero_ids: [hero_id] })}
          >
            {dapp_text(copy, 'position_stop')}
          </Button>
        ) : (
          <Button onClick={() => dispatch_app({ type: 'dapp/dismiss', position_id: position.id })}>
            {dapp_text(copy, 'position_dismiss')}
          </Button>
        )}
      </footer>
    </article>
  )
}

export const DappPositions = ({ copy, locale }: Readonly<{ copy: AppCopy; locale: Locale }>) => {
  const positions = useAppStore(({ dapp }) => dapp.positions)
  return (
    <section className="dapp-section" aria-label={dapp_text(copy, 'positions_title')}>
      <h2>{dapp_text(copy, 'positions_title')}</h2>
      {positions.length === 0 ? (
        <p className="dapp-note">{dapp_text(copy, 'positions_empty')}</p>
      ) : (
        <div className="dapp-positions">
          {positions.map((position) => (
            <PositionCard key={position.id} copy={copy} locale={locale} position={position} />
          ))}
        </div>
      )}
      <Haul copy={copy} locale={locale} />
    </section>
  )
}
