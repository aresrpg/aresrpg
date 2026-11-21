// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { Button, ConfirmDialog, Panel } from '@aresrpg/ui'
import type { CharacterRow } from '@aresrpg/protocol'
import { useState } from 'react'

import type { AppCopy } from '../i18n/copy.ts'
import type { Locale } from '../i18n/locale.ts'
import { dispatch_app, useAppStore } from '../store.ts'
import { content_catalog } from '../content/catalog.ts'

import { dapp_text } from './copy.ts'
import { DappHeroCard } from './DappHeroCard.tsx'
import { DappRaidRun } from './DappRaidRun.tsx'
import { DappRaidSetup } from './DappRaidSetup.tsx'
import { raid_starting, raid_text, room_title, type RaidText } from './raid.ts'
import { direct_free, hero_hosted, type DappInput, type DappState } from './state.ts'

import './dapp_raid.css'

type Hero = Readonly<CharacterRow>

export type RaidRoute = 'empty' | 'setup' | 'follow'
/**
 * What the Raid tab shows. A raid the bot plays, was just asked to start, or that ended is followed;
 * with none of them, or while the player plans another team, it is the setup.
 */
export const raid_route = (dapp: DappState, heroes: number, planning: boolean): RaidRoute => {
  if (!heroes) return 'empty'
  const followed = dapp.positions.some(({ activity }) => activity === 'raid') || raid_starting(dapp).length > 0
  return followed && !planning ? 'follow' : 'setup'
}

type Inside = Hero & Readonly<{ dungeon_run: NonNullable<Hero['dungeon_run']> }>
/** Heroes inside a dungeon run that the bot does not play: only they can leave without entering again. */
export const raid_inside = (dapp: DappState, heroes: readonly Hero[]): readonly Inside[] =>
  heroes.filter((hero): hero is Inside => Boolean(hero.dungeon_run) && !hero_hosted(dapp, hero.id))
/** A hero leaves the dungeon run it stands in: the bot's own `dungeon_leave` payload. */
const leave_input = (id: string, hero: Pick<Inside, 'id' | 'dungeon_run'>): DappInput => ({
  type: 'dapp/hero_direct',
  id,
  hero_id: hero.id,
  action: 'dungeon_leave',
  payload: { character_id: hero.id, dungeon: hero.dungeon_run.dungeon },
})

/** An account with no hero has no team to seat: its first steps are on Home. */
const RaidEmpty = ({ copy }: Readonly<{ copy: AppCopy }>) => (
  <Panel className="dapp-raid-panel" data-raid-empty="">
    <h2>{dapp_text(copy, 'raid_empty_title')}</h2>
    <p className="dapp-note">{dapp_text(copy, 'raid_empty_body')}</p>
    <Button tone="primary" onClick={() => dispatch_app({ type: 'dapp/tab', tab: 'home' })}>
      {dapp_text(copy, 'nav_home')}
    </Button>
  </Panel>
)

/** One hero left inside a dungeon: the room it stands in, and the one way out. */
const InsideHero = ({
  copy,
  text,
  hero,
  ask,
}: Readonly<{ copy: AppCopy; text: RaidText; hero: Inside; ask: (hero_id: string) => void }>) => {
  const free = useAppStore(({ dapp }) => direct_free(dapp))
  const dungeon = content_catalog.dungeon(hero.dungeon_run.dungeon)
  return (
    <DappHeroCard
      copy={copy}
      hero={hero}
      compact
      actions={
        <>
          {dungeon && <span className="dapp-raid-room">{room_title(text, dungeon, hero.dungeon_run.room)}</span>}
          <Button disabled={!free} data-raid-leave={hero.id} onClick={() => ask(hero.id)}>
            {text('raid_leave')}
          </Button>
        </>
      }
    />
  )
}

/** Heroes left inside a dungeon run, over one given view state: `leaving` is the hero being asked about. */
export const RaidInsideView = ({
  copy,
  leaving,
  ask,
}: Readonly<{ copy: AppCopy; leaving: string | null; ask: (hero_id: string | null) => void }>) => {
  const dapp = useAppStore((state) => state.dapp)
  const heroes = useAppStore((state) => state.session.agent_inventory.characters)
  const text = raid_text(copy)
  const inside = raid_inside(dapp, heroes)
  const asked = inside.find(({ id }) => id === leaving)
  if (!inside.length) return null
  return (
    <section className="dapp-section" data-raid-inside="">
      <h2>{text('raid_inside_title')}</h2>
      <p className="dapp-note">{text('raid_inside_body')}</p>
      <div className="dapp-raid-cards">
        {inside.map((hero) => (
          <InsideHero key={hero.id} copy={copy} text={text} hero={hero} ask={ask} />
        ))}
      </div>
      {asked && (
        <ConfirmDialog
          danger
          title={text('raid_leave')}
          description={text('raid_leave_body')}
          confirm_label={text('raid_leave')}
          cancel_label={text('cancel')}
          close_label={text('close')}
          on_cancel={() => ask(null)}
          on_confirm={() => {
            ask(null)
            dispatch_app(leave_input(crypto.randomUUID(), asked))
          }}
        />
      )}
    </section>
  )
}

/**
 * Heroes that stand inside a dungeon run the bot does not play. Leaving abandons the run and its key,
 * so it asks once. A hero the bot still plays is stopped first: its raid would enter again at once.
 */
const DappRaidInside = ({ copy }: Readonly<{ copy: AppCopy }>) => {
  const [leaving, ask] = useState<string | null>(null)
  return <RaidInsideView copy={copy} leaving={leaving} ask={ask} />
}

type Props = Readonly<{ copy: AppCopy; locale: Locale }>
/** The Raid tab over one given view state: `planning` is the player setting up a team beside a followed raid. */
export const RaidTab = ({
  copy,
  locale,
  planning,
  plan,
}: Props & Readonly<{ planning: boolean; plan: (planning: boolean) => void }>) => {
  const dapp = useAppStore((state) => state.dapp)
  const heroes = useAppStore((state) => state.session.agent_inventory.characters.length)
  const route = raid_route(dapp, heroes, planning)
  const followed = raid_route(dapp, heroes, false) === 'follow'
  return (
    <div className="dapp-raid" data-raid-route={route}>
      {route === 'empty' && <RaidEmpty copy={copy} />}
      {route === 'setup' && (
        <DappRaidSetup
          copy={copy}
          locale={locale}
          entered={() => plan(false)}
          back={followed ? () => plan(false) : null}
        />
      )}
      {route === 'follow' && <DappRaidRun copy={copy} locale={locale} plan={() => plan(true)} />}
      {route !== 'empty' && <DappRaidInside copy={copy} />}
    </div>
  )
}

/**
 * The Raid tab: the setup of a team, the raids it follows and what they brought back. Which of them
 * shows comes from the positions; the one thing kept here is that the player opened the setup.
 */
export const DappRaid = (props: Props) => {
  const [planning, plan] = useState(false)
  return <RaidTab {...props} planning={planning} plan={plan} />
}
