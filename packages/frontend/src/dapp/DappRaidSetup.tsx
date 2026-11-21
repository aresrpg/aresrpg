// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The raid a player plans: the dungeon, the seats, the keys, the rooms and the two optional caps.
// The page proposes a dungeon and a team; it seats nobody and sends nothing by itself.
import { Button, ConfirmDialog, GameWindow, NativeModal, Panel, SegmentedControl } from '@aresrpg/ui'
import type { CharacterRow } from '@aresrpg/protocol'
import { raid_entrants, type RaidBag } from '@aresrpg/protocol/strategies'
import { Plus } from 'lucide-react'
import { useState } from 'react'

import type { AppCopy } from '../i18n/copy.ts'
import type { Locale } from '../i18n/locale.ts'
import { dispatch_app, useAppStore } from '../store.ts'
import { item_icon, mob_icon } from '../content/assets.ts'
import { content_catalog, titleize, type SeedDungeon } from '../content/catalog.ts'
import { encyclopedia_text } from '../encyclopedia/copy.ts'

import { account_bag, type DappAccount } from './account.ts'
import { bot_wait_key } from './copy.ts'
import { DappDropsSheet } from './DappDropsSheet.tsx'
import { DappHeroCard, hero_class, HeroPortrait } from './DappHeroCard.tsx'
import { DappHeroPicker } from './DappHeroPicker.tsx'
import { DappItemRow, DappItemSheet } from './DappItemSheet.tsx'
import { RaidDropRows, RaidKeysShort } from './DappRaidRun.tsx'
import { DappFeeCap, DappPotionButton, fee_text, fee_valid, walk_time } from './DappStartParts.tsx'
import { dungeon_keys, proposed_dungeon, proposed_team, raid_spec } from './next_step.ts'
import { dungeon_rooms, travel_potion, walk_seconds } from './places.ts'
import {
  boss_name,
  dungeon_boss,
  dungeon_gates,
  enter_step,
  RAID_DROPS_SHOWN,
  raid_ladder,
  raid_text,
  raid_title,
  seat_taken,
  seats_input,
  type RaidText,
} from './raid.ts'
import {
  activity_offer,
  bot_ready,
  bot_unreachable,
  hero_command,
  raid_seats,
  running_position,
  type DappState,
} from './state.ts'
import { plan_keys_missing, RAID_TEAM, raid_resumes, type Blocker } from './strategies.ts'

import './dapp_raid.css'

type Hero = Readonly<CharacterRow>

/** The run counts the Runs control offers beside "while keys last": the mockup's two. */
const RUN_CHOICES: readonly number[] = [1, 3]
/** Why a seated hero stays behind, other than a missing key: that one has a panel of its own. */
const BLOCKERS: readonly Blocker[] = ['hero_busy', 'hero_unknown', 'world_required']

/** The seats the shared key rule lets in, in order: one hero per usable key of its own kiosk. */
const keyed_seats = (dungeon: SeedDungeon, seats: readonly Hero[], bag: RaidBag): readonly string[] =>
  raid_entrants({ dungeon: dungeon.dungeon, key: dungeon.key, team: seats.map(({ id }) => id), heroes: seats, bag })

/** Everything the setup shows, derived from the store at each render: nothing of it is kept. */
const raid_setup = (text: RaidText, dapp: DappState, account: DappAccount) => {
  const dungeon = content_catalog.dungeon(proposed_dungeon(dapp, account) ?? '')
  const spec = raid_spec(dapp, account)
  if (!dungeon || !spec) return null
  const title = raid_title(text, dungeon)
  const seats = raid_seats(dapp, account)
  const bag = account_bag(account)
  return {
    dungeon,
    rooms: dungeon_rooms(dungeon),
    spec,
    title,
    seats,
    bag,
    /** Null while the bag is still being read: no count is claimed. */
    keys: bag ? (dungeon_keys(account)[dungeon.dungeon] ?? 0) : null,
    keyed: bag ? keyed_seats(dungeon, seats, bag) : null,
    offer: activity_offer(dapp, account, spec, title),
    gates: dungeon_gates(dungeon.dungeon),
  }
}
type Setup = Readonly<NonNullable<ReturnType<typeof raid_setup>>>

export type SetupSheet = Readonly<
  { kind: 'seat'; seat: number } | { kind: 'drops' } | { kind: 'item'; item_type: string } | { kind: 'short' }
> | null
type Open = (sheet: SetupSheet) => void
/** The setup's own view state: the sheet that is open and the fee limit as it is typed. */
export type SetupDraft = Readonly<{ sheet: SetupSheet; open: Open; fee: string; set_fee: (typed: string) => void }>
type Shared = Readonly<{ copy: AppCopy; text: RaidText; setup: Setup }>

const Dungeons = ({ text, setup }: Pick<Shared, 'text' | 'setup'>) => (
  <div className="dapp-raid-dungeons" role="group" aria-label={text('raid_dungeon')}>
    {content_catalog.dungeons.map((dungeon) => {
      const boss = dungeon_boss(dungeon)
      const art = boss && mob_icon(boss.mob_type)
      return (
        <Button
          key={dungeon.dungeon}
          aria-pressed={dungeon === setup.dungeon}
          data-dungeon={dungeon.dungeon}
          onClick={() => dispatch_app({ type: 'dapp/raid_pick', pick: { dungeon: dungeon.dungeon } })}
        >
          {art && <img src={art} alt="" />}
          <span>{titleize(dungeon.dungeon)}</span>
        </Button>
      )
    })}
  </div>
)

/** The dungeon as the seed authors it, and the keys the heroes hold for it. */
const DungeonFacts = ({ text, setup, open }: Pick<Shared, 'text' | 'setup'> & Readonly<{ open: Open }>) => {
  const { dungeon, keys } = setup
  return (
    <Panel className="dapp-raid-panel" data-raid-dungeon={dungeon.dungeon}>
      <h3>{titleize(dungeon.dungeon)}</h3>
      <p className="dapp-note">
        {text('raid_dungeon_facts', {
          rooms: String(dungeon.rooms.length),
          monsters: String(dungeon.rooms.reduce((total, room) => total + room.length, 0)),
          boss: boss_name(dungeon),
        })}
      </p>
      <ul className="dapp-rows">
        <li>
          <DappItemRow
            item_type={dungeon.key}
            value={keys === null ? '' : `×${keys}`}
            open={() => open({ kind: 'item', item_type: dungeon.key })}
          />
        </li>
      </ul>
      <p className="dapp-note" data-raid-keys={keys ?? undefined}>
        {keys === null ? text('bag_loading') : text('raid_keys_held', { count: String(keys) })}
      </p>
      <Button onClick={() => open({ kind: 'drops' })}>
        {text('drops_dungeon_title', { dungeon: titleize(dungeon.dungeon) })}
      </Button>
    </Panel>
  )
}

/** What a seat says of its hero's key: the shared rule's word, or that the hero already stands inside. */
const seat_key = ({ dungeon, keyed }: Setup, hero: Hero): string | null => {
  if (raid_resumes(dungeon.dungeon, hero)) return 'status_dungeon'
  if (!keyed) return null
  return keyed.includes(hero.id) ? 'raid_seat_key' : 'raid_seat_no_key'
}
const SeatHero = ({ copy, text, setup, hero }: Shared & Readonly<{ hero: Hero }>) => {
  const key = seat_key(setup, hero)
  return (
    <>
      <HeroPortrait hero={hero} small />
      <strong>{hero.name}</strong>
      <small>{`${text('hero_level', { level: String(hero.level) })} · ${hero_class(copy, hero)}`}</small>
      {key && <small data-seat-key={key === 'raid_seat_no_key' ? 'none' : 'held'}>{text(key)}</small>}
    </>
  )
}
const EmptySeat = ({ text }: Pick<Shared, 'text'>) => (
  <>
    <Plus size={18} aria-hidden="true" />
    {text('raid_seat_add')}
  </>
)

/** The seats of one fight side. A proposal only fills them when the player asks for it. */
const Board = ({ copy, text, setup, open }: Shared & Readonly<{ open: Open }>) => {
  const dapp = useAppStore((state) => state.dapp)
  const account = useAppStore((state) => state.session.agent_inventory)
  const best = proposed_team(dapp, account, setup.dungeon.dungeon).map(({ id }) => id)
  return (
    <section className="dapp-raid-block">
      <header className="dapp-raid-bar">
        <h3>
          {text('raid_team')}{' '}
          <small>{text('raid_team_count', { count: String(setup.seats.length), size: String(RAID_TEAM) })}</small>
        </h3>
        <Button disabled={!best.length} onClick={() => dispatch_app(seats_input(best))}>
          {text('raid_best_team')}
        </Button>
      </header>
      <div className="dapp-raid-board">
        {Array.from({ length: RAID_TEAM }, (_, seat) => {
          const hero = setup.seats[seat]
          return (
            <Button
              key={seat}
              className="dapp-raid-seat"
              data-seat={seat + 1}
              data-hero={hero?.id}
              data-empty={hero ? undefined : ''}
              onClick={() => open({ kind: 'seat', seat })}
            >
              {hero ? <SeatHero copy={copy} text={text} setup={setup} hero={hero} /> : <EmptySeat text={text} />}
            </Button>
          )
        })}
      </div>
    </section>
  )
}

/**
 * One seat: who sits there, and who could. A hero the bot plays elsewhere is stopped first, then
 * added by hand once it is free; a hero in a fight or a dungeon stays listed with what it does.
 */
const SeatSheet = ({ copy, text, setup, seat, close }: Shared & Readonly<{ seat: number; close: () => void }>) => {
  const dapp = useAppStore((state) => state.dapp)
  const heroes = useAppStore((state) => state.session.agent_inventory.characters)
  const ids = setup.seats.map(({ id }) => id)
  const occupant = setup.seats[seat]
  const others = heroes.filter(({ id }) => !ids.includes(id))
  const out = others.filter(({ id }) => running_position(dapp, id) !== null)
  const rest = others.filter((hero) => !out.includes(hero))
  const title = text('raid_seat_title', { seat: String(seat + 1) })
  const pick_label = text(occupant ? 'raid_seat_swap' : 'raid_seat_add')
  const seated = (hero_ids: readonly string[]) => {
    dispatch_app(seats_input(hero_ids))
    close()
  }
  return (
    <NativeModal close={close} label={title} className="aui-modal-scrim">
      <GameWindow title={title} close={close} close_label={text('close')} className="aui-inspection" data-seat-sheet="">
        <div className="dapp-sheet-body">
          {occupant && (
            <DappHeroCard
              copy={copy}
              hero={occupant}
              compact
              actions={
                <Button onClick={() => seated(ids.filter((id) => id !== occupant.id))}>
                  {text('raid_seat_remove')}
                </Button>
              }
            />
          )}
          {rest.length > 0 && (
            <section className="dapp-raid-block">
              <h4>{pick_label}</h4>
              <DappHeroPicker
                copy={copy}
                label={pick_label}
                heroes={rest}
                selected={[]}
                busy_selectable={(hero) => raid_resumes(setup.dungeon.dungeon, hero)}
                on_change={([hero_id]) => hero_id && seated(seat_taken(ids, seat, hero_id))}
              />
            </section>
          )}
          {out.map((hero) => (
            <DappHeroCard
              key={hero.id}
              copy={copy}
              hero={hero}
              compact
              actions={
                <Button
                  disabled={hero_command(dapp, hero.id) !== null}
                  onClick={() => dispatch_app({ type: 'dapp/stop', id: crypto.randomUUID(), hero_ids: [hero.id] })}
                >
                  {text('position_stop')}
                </Button>
              }
            />
          ))}
          {out.length > 0 && <p className="dapp-note">{text('raid_seat_stop_note')}</p>}
          {!others.length && <p className="dapp-note">{text('raid_seat_none')}</p>}
        </div>
      </GameWindow>
    </NativeModal>
  )
}

/** The seated heroes' levels beside each room's monsters: the facts a player judges a team by. */
const Levels = ({ copy, text, setup }: Shared) => {
  const [alone] = setup.seats
  return (
    <section className="dapp-raid-block">
      <h4>{text('raid_levels_title')}</h4>
      <p className="dapp-note">
        {setup.seats.map(({ name, level }) => `${name} · ${text('hero_level', { level: String(level) })}`).join(', ')}
      </p>
      {setup.seats.length === 1 && alone && <p className="dapp-note">{text('raid_alone', { name: alone.name })}</p>}
      <dl className="dapp-raid-levels">
        {setup.rooms.map(({ room, boss, levels }) => (
          <div key={room} data-room={room}>
            <dt>
              {boss
                ? text('raid_boss_room', { boss: boss_name(setup.dungeon) })
                : text('drops_room', { room: String(room) })}
            </dt>
            <dd>{levels && encyclopedia_text(copy)('level_range', levels)}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

/**
 * How the heroes reach the gates. Walking is a fact of the plan, never a blocker: the bot walks them
 * first. A hero that holds the city's potion may drink it, one hero at a time.
 */
const Travel = ({ copy, text, setup, locale }: Shared & Readonly<{ locale: Locale }>) => {
  const { seats, offer, gates, bag } = setup
  const walkers = seats.filter(({ id }) => offer.plan.starts.some(({ hero_id, walks }) => walks && hero_id === id))
  if (!walkers.length) return null
  return (
    <section className="dapp-raid-block" data-raid-travel="">
      <p className="dapp-note">{text('quest_walks', { names: walkers.map(({ name }) => name).join(', ') })}</p>
      {gates &&
        walkers.map((hero) => {
          const seconds = walk_seconds(hero, gates)
          const potion = bag && travel_potion(bag, hero, gates)
          if (seconds === null && !potion) return null
          return (
            <div key={hero.id} className="dapp-notice-row" data-walker={hero.id}>
              <p className="dapp-notice-text">
                {seconds === null
                  ? hero.name
                  : text('raid_walk', { name: hero.name, time: walk_time(locale, seconds) })}
              </p>
              {potion && <DappPotionButton copy={copy} hero={hero} potion={potion} />}
            </div>
          )
        })}
    </section>
  )
}

type RunChoice = `${number}` | 'all'
/** How many dungeon runs each hero sees end, and the SUI its own run may pay. Both are optional and count per hero. */
const Caps = ({ copy, text, fee, set_fee }: Omit<Shared, 'setup'> & Pick<SetupDraft, 'fee' | 'set_fee'>) => {
  const runs = useAppStore(({ dapp }) => dapp.raid.runs)
  const cap = useAppStore(({ dapp }) => dapp.raid.fee_cap_mist)
  return (
    <section className="dapp-raid-block" data-raid-caps="">
      <h4>{text('raid_runs')}</h4>
      <SegmentedControl<RunChoice>
        label={text('raid_runs')}
        value={runs === null ? 'all' : `${runs}`}
        options={[
          ...RUN_CHOICES.map((count) => ({ value: `${count}` as const, label: String(count) })),
          { value: 'all', label: text('raid_runs_all') },
        ]}
        on_change={(choice) =>
          dispatch_app({ type: 'dapp/raid_pick', pick: { runs: choice === 'all' ? null : Number(choice) } })
        }
      />
      <p className="dapp-note" data-raid-runs={runs ?? 'all'}>
        {runs === null ? text('raid_repeats') : text('raid_runs_count', { count: String(runs) })}
      </p>
      {/* An entry that cannot be read changes nothing: the last limit stays, and Enter waits. */}
      <DappFeeCap
        copy={copy}
        cap={cap}
        typed={fee}
        type={set_fee}
        pick={(fee_cap_mist) => dispatch_app({ type: 'dapp/raid_pick', pick: { fee_cap_mist } })}
      />
    </section>
  )
}

const names_of = (heroes: readonly Hero[], ids: readonly string[]): string =>
  heroes
    .filter(({ id }) => ids.includes(id))
    .map(({ name }) => name)
    .join(', ')
/** Seated heroes that stay behind, one line per reason. A missing key has its own panel. */
const Blocked = ({ text, setup }: Pick<Shared, 'text' | 'setup'>) =>
  BLOCKERS.map((blocker) => {
    const ids = setup.offer.plan.blocked.flatMap((entry) => (entry.blocker === blocker ? [entry.hero_id] : []))
    return ids.length ? (
      <p key={blocker} className="dapp-warning" data-blocker={blocker}>
        {text(`blocker_${blocker}`, { names: names_of(setup.seats, ids) })}
      </p>
    ) : null
  })

/** Heroes of the plan that burn a key: one already inside the dungeon goes on with its run. */
const keys_staked = ({ dungeon, seats, offer }: Setup): number =>
  seats.filter(
    (hero) => !raid_resumes(dungeon.dungeon, hero) && offer.plan.starts.some(({ hero_id }) => hero_id === hero.id)
  ).length

type PlanProps = Shared & Readonly<{ locale: Locale; draft: SetupDraft; enter: () => void }>
/** The plan of the seated team: what it can win, what it meets, what it costs and the one Enter. */
const Plan = ({ copy, text, setup, locale, draft, enter }: PlanProps) => {
  const ready = useAppStore(({ dapp }) => bot_ready(dapp))
  const unreachable = useAppStore(({ dapp }) => bot_unreachable(dapp))
  const { dungeon, rooms } = setup
  const { plan } = setup.offer
  const missing = plan_keys_missing(plan)
  const staked = String(keys_staked(setup))
  const key_art = item_icon(dungeon.key)
  return (
    <Panel className="dapp-raid-panel dapp-raid-plan" data-raid-plan="">
      <section className="dapp-raid-block">
        <h4>{text('raid_drops_title')}</h4>
        <RaidDropRows
          copy={copy}
          locale={locale}
          dungeon={dungeon}
          drops={raid_ladder(rooms).slice(0, RAID_DROPS_SHOWN)}
          inspect={(item_type) => draft.open({ kind: 'item', item_type })}
        />
      </section>
      <Levels copy={copy} text={text} setup={setup} />
      <Travel copy={copy} text={text} setup={setup} locale={locale} />
      <Caps copy={copy} text={text} fee={draft.fee} set_fee={draft.set_fee} />
      <Blocked text={text} setup={setup} />
      {missing > 0 && <RaidKeysShort copy={copy} dungeon={dungeon} missing={missing} />}
      {!ready && (
        <p className="dapp-note" role="status" aria-busy={!unreachable}>
          {text(bot_wait_key(unreachable))}
        </p>
      )}
      {(plan.starts.length > 0 || missing === 0) && (
        <footer className="dapp-raid-foot">
          <p className="dapp-note">{text('raid_stake', { count: staked })}</p>
          <Button
            tone="primary"
            disabled={enter_step(plan) === 'blocked' || !fee_valid(draft.fee, null)}
            data-raid-enter={staked}
            onClick={enter}
          >
            {key_art && <img src={key_art} alt="" />}
            {text('raid_enter', { count: staked })}
          </Button>
        </footer>
      )}
    </Panel>
  )
}

/** Too few keys for the whole team: the player reads who enters, then chooses. Nothing is sent before. */
const ShortNotice = ({
  text,
  setup,
  close,
  send,
}: Pick<Shared, 'text' | 'setup'> & Readonly<Record<'close' | 'send', () => void>>) => {
  const entering = setup.offer.plan.starts.map(({ hero_id }) => hero_id)
  const count = String(entering.length)
  return (
    <ConfirmDialog
      title={text('raid_short_title')}
      description={text('raid_short_body', { count, names: names_of(setup.seats, entering) })}
      confirm_label={text('raid_short_action', { count })}
      cancel_label={text('cancel')}
      close_label={text('close')}
      on_cancel={close}
      on_confirm={send}
    />
  )
}

type SheetsProps = Shared & Readonly<{ locale: Locale; draft: SetupDraft; send: () => void }>
/** One sheet at a time, over the setup. */
const Sheets = ({ copy, text, setup, locale, draft: { sheet, open }, send }: SheetsProps) => {
  const close = () => open(null)
  const dungeon = { kind: 'dungeon', dungeon: setup.dungeon.dungeon } as const
  if (sheet?.kind === 'seat') return <SeatSheet copy={copy} text={text} setup={setup} seat={sheet.seat} close={close} />
  if (sheet?.kind === 'drops') return <DappDropsSheet copy={copy} locale={locale} subject={dungeon} close={close} />
  if (sheet?.kind === 'item')
    return <DappItemSheet copy={copy} subject={{ kind: 'type', item_type: sheet.item_type }} close={close} />
  return sheet && <ShortNotice text={text} setup={setup} close={close} send={send} />
}

type SetupProps = Readonly<{
  copy: AppCopy
  locale: Locale
  /** Runs once a start was sent: the tab then follows the raid. */
  entered: () => void
  /** The way back to the raids already followed; null when there is none. */
  back: (() => void) | null
}>
/** The setup over one given view state. */
export const RaidSetupView = ({ copy, locale, entered, back, draft }: SetupProps & Readonly<{ draft: SetupDraft }>) => {
  const dapp = useAppStore((state) => state.dapp)
  const account = useAppStore((state) => state.session.agent_inventory)
  const text = raid_text(copy)
  const setup = raid_setup(text, dapp, account)
  if (!setup) return null
  const shared = { copy, text, setup }
  const send = () => {
    draft.open(null)
    dispatch_app({ type: 'dapp/start', id: crypto.randomUUID(), spec: setup.spec, title: setup.title })
    entered()
  }
  const enter = () => (enter_step(setup.offer.plan) === 'confirm' ? draft.open({ kind: 'short' }) : send())
  return (
    <section className="dapp-raid-setup" data-raid-setup={setup.dungeon.dungeon}>
      <header className="dapp-raid-bar">
        <div className="dapp-section">
          <h2>{setup.title}</h2>
          <p className="dapp-note">{text('raid_intro')}</p>
        </div>
        {back && <Button onClick={back}>{text('raid_back')}</Button>}
      </header>
      <div className="dapp-raid-split">
        <div className="dapp-raid-column">
          <Dungeons text={text} setup={setup} />
          <DungeonFacts text={text} setup={setup} open={draft.open} />
          <Board {...shared} open={draft.open} />
        </div>
        {setup.seats.length ? (
          <Plan {...shared} locale={locale} draft={draft} enter={enter} />
        ) : (
          <p className="dapp-warning" data-raid-plan="empty">
            {text('raid_no_seat')}
          </p>
        )}
      </div>
      <Sheets {...shared} locale={locale} draft={draft} send={send} />
    </section>
  )
}

/** The raid setup. Its only state of its own is what is open and what is being typed. */
export const DappRaidSetup = (props: SetupProps) => {
  const cap = useAppStore(({ dapp }) => dapp.raid.fee_cap_mist)
  const [sheet, open] = useState<SetupSheet>(null)
  const [fee, set_fee] = useState(() => fee_text(cap))
  return <RaidSetupView {...props} draft={{ sheet, open, fee, set_fee }} />
}
