// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { ReactNode } from 'react'
import { Button, Panel } from '@aresrpg/ui'
import type { CharacterRow } from '@aresrpg/protocol'
import { UserPlus } from 'lucide-react'

import type { AppCopy } from '../i18n/copy.ts'
import type { Locale } from '../i18n/locale.ts'
import { dispatch_app, useAppStore } from '../store.ts'
import { mob_icon } from '../content/assets.ts'
import { content_catalog, titleize } from '../content/catalog.ts'
import { character_send_eligible } from '../agents/character_send.ts'
import { useCharacterRecall } from '../agents/useCharacterRecall.tsx'

import { account_bag, type DappAccount } from './account.ts'
import { dapp_text, fees_paid, item_name } from './copy.ts'
import { DappBag } from './DappBag.tsx'
import { DappCreateHero } from './DappCreateHero.tsx'
import { DappGameHeroes } from './DappGameHeroes.tsx'
import { DappHeroCard, HeroPortrait } from './DappHeroCard.tsx'
import { next_step, proposed_dungeon, proposed_team, type NextStep } from './next_step.ts'
import { dungeon_rooms, key_sources } from './places.ts'
import {
  direct_free,
  hero_command,
  hero_hosted,
  hero_sendable,
  hero_status,
  running_position,
  type DappInput,
  type DappState,
} from './state.ts'
import { raid_able, RAID_TEAM } from './strategies.ts'

import './dapp_home.css'

type Hero = Readonly<CharacterRow>
type Text = (key: string, values?: Readonly<Record<string, string>>) => string
/** What every view of Home reads: the page's words, what the bot said and what the game server pushed. */
type Seen = Readonly<{ text: Text; dapp: DappState; account: DappAccount; back: TakeBack }>
/** The way back to the player's own game account: the game's recall gesture, and whether one is under way. */
type TakeBack = Readonly<{ recall: (hero_id: string) => void; busy: boolean }>

/** A button of Home fills a pick, then opens the tab that shows it. Nothing is sent to the bot from here. */
export const quest_inputs = (hero_id: string): readonly DappInput[] => [
  { type: 'dapp/quest_pick', pick: { hero_ids: [hero_id] } },
  { type: 'dapp/tab', tab: 'quest' },
]
/** The hero takes a seat beside those already picked. A full side keeps its latest picks. */
export const seat_inputs = ({ raid }: DappState, hero_id: string): readonly DappInput[] => [
  {
    type: 'dapp/raid_pick',
    pick: { hero_ids: [...raid.hero_ids.filter((id) => id !== hero_id), hero_id].slice(-RAID_TEAM) },
  },
  { type: 'dapp/tab', tab: 'raid' },
]
/** The team the page proposes for a dungeon takes its seats. */
export const team_inputs = (dapp: DappState, account: DappAccount, dungeon: string): readonly DappInput[] => [
  { type: 'dapp/raid_pick', pick: { dungeon, hero_ids: proposed_team(dapp, account, dungeon).map(({ id }) => id) } },
  { type: 'dapp/tab', tab: 'raid' },
]
const send = (inputs: readonly DappInput[]): void => inputs.forEach(dispatch_app)

/** A free hero could enter some dungeon now: the shared key rule lets it in. */
const raid_ready = (hero: Hero, account: DappAccount): boolean => {
  const bag = account_bag(account)
  return content_catalog.dungeons.some(({ dungeon }) => raid_able(dungeon, [hero], bag).length > 0)
}

/** A hero the bot plays has one Stop of its own; a raid is watched on its tab. */
const hosted_actions = ({ text, dapp }: Seen, hero: Hero): ReactNode => {
  const command = hero_command(dapp, hero.id)
  return (
    <>
      {running_position(dapp, hero.id)?.activity === 'raid' && (
        <Button onClick={() => dispatch_app({ type: 'dapp/tab', tab: 'raid' })}>{text('hero_watch_raid')}</Button>
      )}
      <Button
        busy={command?.kind === 'stop'}
        disabled={command !== null}
        onClick={() => dispatch_app({ type: 'dapp/stop', id: crypto.randomUUID(), hero_ids: [hero.id] })}
      >
        {text('position_stop')}
      </Button>
    </>
  )
}
/** A hero gives up the fight it is seated in: the bot's own `fight_forfeit` payload. */
export const forfeit_input = (hero_id: string): DappInput => ({
  type: 'dapp/hero_direct',
  id: crypto.randomUUID(),
  hero_id,
  action: 'fight_forfeit',
  payload: { character_id: hero_id },
})
/**
 * What the player can do with one hero from Home. A hosted hero is stopped, never sent. A hero that
 * can be sent is sent, and the raid leads when it could enter one now. A hero in a fight the bot does
 * not play can still be sent (its run ends that fight first) or can give the fight up. A hero at
 * rest can go back to the player's game account. A hero the bot has not spoken of, or one inside a
 * dungeon run, offers nothing here.
 */
const hero_actions = (seen: Seen, hero: Hero): ReactNode => {
  const { text, dapp, account, back } = seen
  if (hero_hosted(dapp, hero.id)) return hosted_actions(seen, hero)
  if (hero_status(dapp, hero) === null || !hero_sendable(dapp, hero)) return null
  const raid = raid_ready(hero, account)
  return (
    <>
      {hero.active_fight && (
        <Button disabled={!direct_free(dapp)} data-forfeit="" onClick={() => send([forfeit_input(hero.id)])}>
          {text('hero_forfeit')}
        </Button>
      )}
      <Button tone={raid ? 'neutral' : 'primary'} onClick={() => send(quest_inputs(hero.id))}>
        {text('hero_send_quest')}
      </Button>
      <Button tone={raid ? 'primary' : 'neutral'} onClick={() => send(seat_inputs(dapp, hero.id))}>
        {text('hero_raid')}
      </Button>
      {character_send_eligible(hero) && (
        <Button disabled={back.busy} data-take-back="" onClick={() => back.recall(hero.id)}>
          {text('hero_take_back')}
        </Button>
      )}
    </>
  )
}

type StepView = Readonly<{
  title: string
  body: string
  art?: ReactNode
  action?: Readonly<{ label: string; inputs: readonly DappInput[] }>
}>
const boss_icon = (dungeon: string): string | null => {
  const seed = content_catalog.dungeon(dungeon)
  return mob_icon((seed && dungeon_rooms(seed).at(-1)?.mob_types[0]) ?? '')
}
type StepViews = {
  readonly [K in NextStep['kind']]: (step: Extract<NextStep, { kind: K }>, seen: Seen) => StepView
}
/**
 * One view per next step. Adding SUI has no button here: the wallet menu of the page owns every
 * payment into the bot wallet.
 */
const STEP_VIEWS: StepViews = {
  funds: (_step, { text }) => ({ title: text('next_funds_title'), body: text('next_funds_body') }),
  raid: ({ dungeon, keys }, { text, dapp, account }) => {
    const icon = boss_icon(dungeon)
    return {
      title: text('next_raid_title', { dungeon: titleize(dungeon) }),
      body: text('next_raid_body', { count: String(keys) }),
      art: icon && <img className="dapp-portrait" src={icon} alt="" />,
      action: { label: text('next_raid_action'), inputs: team_inputs(dapp, account, dungeon) },
    }
  },
  quest: ({ hero_id }, { text, account }) => {
    const hero = account.characters.find(({ id }) => id === hero_id)
    return {
      title: text('next_quest_title', { name: hero?.name ?? '' }),
      body: text('next_quest_body'),
      art: hero && <HeroPortrait hero={hero} />,
      action: { label: text('next_quest_action'), inputs: quest_inputs(hero_id) },
    }
  },
  out: (_step, { text }) => ({
    title: text('next_out_title'),
    body: text('next_out_body'),
    action: { label: text('next_out_action'), inputs: [{ type: 'dapp/tab', tab: 'quest' }] },
  }),
}

/** The one thing to do next: its picture, its sentence, and its one action under them. */
const NextPanel = ({ seen, step }: Readonly<{ seen: Seen; step: NextStep }>) => {
  const view = STEP_VIEWS[step.kind] as (step: NextStep, seen: Seen) => StepView
  const { title, body, art, action } = view(step, seen)
  const label = seen.text('next_title')
  return (
    <Panel className="dapp-next" aria-label={label} data-next={step.kind}>
      {art}
      <div className="dapp-next-text">
        <span className="dapp-next-label">{label}</span>
        <h2>{title}</h2>
        <p>{body}</p>
      </div>
      {action && (
        <div className="dapp-next-actions">
          <Button tone="primary" onClick={() => send(action.inputs)}>
            {action.label}
          </Button>
        </div>
      )}
    </Panel>
  )
}

type Props = Readonly<{ copy: AppCopy; locale: Locale }>

/** Every hero of the bot account with what it does and what it can be asked, then the way to a new one. */
const Heroes = ({ copy, locale, seen }: Props & Readonly<{ seen: Seen }>) => {
  const { text, account } = seen
  return (
    <section className="dapp-section" aria-label={text('heroes_title')}>
      <header className="dapp-home-title">
        <h2>{text('heroes_title')}</h2>
        <span className="dapp-note">{account.characters.length}</span>
      </header>
      <div className="dapp-home-heroes">
        {account.characters.map((hero) => (
          <DappHeroCard key={hero.id} copy={copy} hero={hero} actions={hero_actions(seen, hero)} />
        ))}
        <Panel className="dapp-create-tile" aria-label={text('add_hero_title')}>
          <span className="dapp-portrait dapp-create-mark" aria-hidden="true">
            <UserPlus size={24} />
          </span>
          <div className="dapp-create-tile-text">
            <h3>{text('add_hero_title')}</h3>
            <DappCreateHero copy={copy} locale={locale} />
          </div>
        </Panel>
      </div>
    </section>
  )
}

const Step = ({
  title,
  body,
  now = false,
  children,
}: Readonly<{ title: string; body: string; now?: boolean; children?: ReactNode }>) => (
  <li className="aui-panel dapp-step" data-now={now || undefined} aria-current={now ? 'step' : undefined}>
    <div className="dapp-step-body">
      <h3>{title}</h3>
      <p>{body}</p>
      {children}
    </div>
  </li>
)
/** The city whose monsters drop a key most often. */
const key_city = (key: string): string | null =>
  key_sources(key).flatMap(({ locations }) => locations.flatMap(({ cities }) => cities))[0] ?? null
/**
 * An account with no hero: the three steps to a first raid. Creating the hero is the only step that can
 * be taken, so it alone has a button; the two others say what comes next, from the seed.
 */
const Onboarding = ({ copy, locale, seen: { text, dapp, account } }: Props & Readonly<{ seen: Seen }>) => {
  const raid = content_catalog.dungeon(proposed_dungeon(dapp, account) ?? '')
  const city = raid && key_city(raid.key)
  return (
    <section className="dapp-welcome" aria-label={text('welcome_title')}>
      <header>
        <h1>{text('welcome_title')}</h1>
        <p>{text('welcome_body')}</p>
      </header>
      <ol className="dapp-steps">
        <Step now title={text('step_create_title')} body={text('step_create_body')}>
          <DappCreateHero copy={copy} locale={locale} primary />
        </Step>
        {raid && city && (
          <>
            <Step
              title={text('step_quest_title')}
              body={text('step_quest_body', { city: titleize(city), key: item_name(raid.key) })}
            />
            <Step title={text('step_raid_title', { dungeon: titleize(raid.dungeon) })} body={text('step_raid_body')} />
          </>
        )}
      </ol>
    </section>
  )
}

/** What the bot wallet paid in network fees, in all: one label and its figure. */
const WalletFees = ({ label, amount }: Readonly<{ label: string; amount: string }>) => (
  <dl className="dapp-ledger" data-wallet-fees="">
    <div>
      <dt>{label}</dt>
      <dd>{amount}</dd>
    </div>
  </dl>
)

/**
 * Home: the one next step and every hero with what it can be asked, or the first steps of an account
 * with no hero. Below them, the heroes still in the player's game account, each with the way to the
 * bot, then the bot's own things: its bag and the fees it paid.
 * Every figure is a fact of the game or a value the bot measured.
 */
export const DappHome = ({ copy, locale }: Props) => {
  const dapp = useAppStore((state) => state.dapp)
  const account = useAppStore(({ session }) => session.agent_inventory)
  const text: Text = (key, values) => dapp_text(copy, key, values)
  const { recall, busy, funding } = useCharacterRecall(copy)
  const seen: Seen = { text, dapp, account, back: { recall, busy } }
  const step = next_step(dapp, account)
  const fees = dapp.observation?.fees_mist ?? null
  return (
    <div className="dapp-home">
      {account.characters.length > 0 && (
        <>
          <h1>{text('home_title')}</h1>
          {step && <NextPanel seen={seen} step={step} />}
          <Heroes copy={copy} locale={locale} seen={seen} />
        </>
      )}
      {account.characters.length === 0 && account.phase === 'ready' && (
        <Onboarding copy={copy} locale={locale} seen={seen} />
      )}
      <DappGameHeroes copy={copy} />
      {funding}
      <DappBag copy={copy} />
      {fees !== null && (
        <WalletFees
          label={text('fees_wallet_label')}
          amount={text('sui_amount', { amount: fees_paid(locale, fees) })}
        />
      )}
    </div>
  )
}
