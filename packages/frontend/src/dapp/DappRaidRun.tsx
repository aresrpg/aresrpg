// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The pieces the raid setup and the followed raids both draw, then the raids a player follows: the
// room each hero stands in, what the team brought back, and how it ended. Every figure is a seed
// fact, a chain row or something this page counted (`raid.ts`); nothing is an estimate.
import { Button, Panel } from '@aresrpg/ui'
import type { CharacterRow } from '@aresrpg/protocol'
import { useState } from 'react'

import type { AppCopy } from '../i18n/copy.ts'
import type { Locale } from '../i18n/locale.ts'
import { dispatch_app, useAppStore } from '../store.ts'
import { mob_icon } from '../content/assets.ts'
import { titleize, type SeedDungeon } from '../content/catalog.ts'

import { dapp_text, item_name } from './copy.ts'
import { DappDropsSheet } from './DappDropsSheet.tsx'
import { DappItemRow, DappItemSheet } from './DappItemSheet.tsx'
import { DappMarketLink } from './DappMarketLink.tsx'
import { DappRunCard } from './DappRunCard.tsx'
import { dungeon_keys } from './next_step.ts'
import { dungeon_rooms } from './places.ts'
import {
  drop_rooms,
  dungeon_boss,
  key_quest_inputs,
  party_fights,
  party_loot,
  raid_again,
  RAID_DROPS_SHOWN,
  raid_ladder,
  raid_parties,
  raid_starting,
  raid_text,
  raid_title,
  raid_verdict,
  room_title,
  team_pick,
  type RaidParty,
  type RaidVerdict,
} from './raid.ts'
import { hero_command } from './state.ts'

import './dapp_raid.css'

type Hero = Readonly<CharacterRow>
type Inspect = (item_type: string) => void

/**
 * What a run of a dungeon can drop, once: a short list with the boss room's rarest drop first, each
 * row with the rooms it drops in and the seed's base rate, then the way to the dungeon's whole table.
 * The game scales a rate with the monster's level, so it reads "about".
 */
export const RaidDrops = ({
  copy,
  locale,
  dungeon,
  inspect,
  more,
}: Readonly<{ copy: AppCopy; locale: Locale; dungeon: SeedDungeon; inspect: Inspect; more: () => void }>) => {
  const text = raid_text(copy)
  return (
    <section className="dapp-raid-block" data-raid-drops={dungeon.dungeon}>
      <h3>{text('raid_drops_title')}</h3>
      <ul className="dapp-rows">
        {raid_ladder(dungeon_rooms(dungeon))
          .slice(0, RAID_DROPS_SHOWN)
          .map(({ item_type, chance_bp, rooms }) => (
            <li key={item_type}>
              <DappItemRow
                item_type={item_type}
                detail={`· ${drop_rooms(text, dungeon, rooms)}`}
                value={text('drops_rate', {
                  rate: (chance_bp / 100).toLocaleString(locale, { maximumFractionDigits: 2 }),
                })}
                open={() => inspect(item_type)}
              />
            </li>
          ))}
      </ul>
      <Button className="dapp-raid-more" onClick={more}>
        {text('drops_dungeon_title', { dungeon: titleize(dungeon.dungeon) })}
      </Button>
    </section>
  )
}

/**
 * The two honest ways to a key. Outside the market there is no price, so the key links to its
 * listings there; quests drop it. One of these stands on screen at a time: the link reads the floor.
 */
export const RaidKeyWays = ({ copy, dungeon }: Readonly<{ copy: AppCopy; dungeon: SeedDungeon }>) => (
  <div className="dapp-raid-actions" data-raid-key-ways="">
    <DappMarketLink copy={copy} item_type={dungeon.key} label={dapp_text(copy, 'raid_buy_key')} tone="primary" />
    <Button onClick={() => key_quest_inputs(dungeon.key).forEach(dispatch_app)}>
      {dapp_text(copy, 'raid_quest_for_keys')}
    </Button>
  </div>
)

/** A team short of keys: how many it lacks, and the ways to get them unless the key line shows them. */
export const RaidKeysShort = ({
  copy,
  dungeon,
  missing,
  ways,
}: Readonly<{ copy: AppCopy; dungeon: SeedDungeon; missing: number; ways: boolean }>) => (
  <div className="dapp-raid-short" data-raid-short={missing}>
    <strong>{dapp_text(copy, 'raid_keys_short', { count: String(missing), item: item_name(dungeon.key) })}</strong>
    {ways && <RaidKeyWays copy={copy} dungeon={dungeon} />}
  </div>
)

/** What is open over the followed raids: the sheet of one item, or every drop of a dungeon. */
export type FollowSheet = Readonly<{ kind: 'item'; item_type: string } | { kind: 'drops'; dungeon: string }> | null
type Shared = Readonly<{ copy: AppCopy; locale: Locale; inspect: (sheet: FollowSheet) => void }>

/** One pip per room: behind the team, where it stands, and ahead. It is a picture of the room title. */
const Track = ({ dungeon, now, label }: Readonly<{ dungeon: SeedDungeon; now: number | null; label: string }>) => (
  <div className="dapp-raid-track" role="img" aria-label={label}>
    {dungeon.rooms.map((_, index) => {
      const room = index + 1
      const state = now !== null && room < now ? 'done' : room === now ? 'now' : undefined
      return <i key={room} data-room-state={state} />
    })}
  </div>
)

/** The room a hero stands in, from its own chain row; null while it is outside that dungeon. */
const room_of = ({ dungeon_run }: Hero, dungeon: SeedDungeon): number | null =>
  dungeon_run?.dungeon === dungeon.dungeon ? dungeon_run.room : null

/**
 * A raid in progress: the rooms behind and ahead, and the room each hero stands in. Stop ends the
 * bot's play and keeps the hero inside its run; leaving is another act.
 */
const LiveParty = ({
  copy,
  party,
  dungeon,
  heroes,
}: Readonly<{ copy: AppCopy; party: RaidParty; dungeon: SeedDungeon; heroes: readonly Hero[] }>) => {
  const dapp = useAppStore((state) => state.dapp)
  const text = raid_text(copy)
  const team = heroes.filter(({ id }) => party.positions.some(({ hero_id }) => hero_id === id))
  const rooms = team.flatMap((hero) => room_of(hero, dungeon) ?? [])
  const now = rooms.length ? Math.max(...rooms) : null
  const where = now === null ? text('raid_walking') : room_title(text, dungeon, now)
  const stoppable = team.filter(({ id }) => hero_command(dapp, id) === null).map(({ id }) => id)
  return (
    <Panel className="dapp-raid-party" data-raid-party={dungeon.dungeon} data-live="">
      <header className="dapp-raid-party-head">
        <h3>{titleize(dungeon.dungeon)}</h3>
        <span>{where}</span>
      </header>
      <Track dungeon={dungeon} now={now} label={where} />
      <ul className="dapp-raid-team">
        {team.map((hero) => {
          const room = room_of(hero, dungeon)
          return (
            <li key={hero.id} data-raid-hero={hero.id}>
              <strong>{hero.name}</strong>
              <span>{room === null ? text('raid_walking') : room_title(text, dungeon, room)}</span>
            </li>
          )
        })}
      </ul>
      <footer className="dapp-raid-stop">
        <Button
          disabled={!stoppable.length}
          onClick={() => dispatch_app({ type: 'dapp/stop', id: crypto.randomUUID(), hero_ids: stoppable })}
        >
          {text('raid_stop_team')}
        </Button>
        <p className="dapp-note">{text('raid_stop_note')}</p>
      </footer>
    </Panel>
  )
}

const VERDICT_TITLES: Readonly<Record<NonNullable<RaidVerdict>, string>> = {
  won: 'raid_result_won',
  lost: 'raid_result_lost',
}
type Result = Readonly<{ copy: AppCopy; party: RaidParty }>

/** How the raid went, in one word, beside its boss. A raid that ended undecided is only "finished". */
const ResultHead = ({ copy, party }: Result) => {
  const text = raid_text(copy)
  const verdict = raid_verdict(party)
  const boss = party.dungeon && dungeon_boss(party.dungeon)
  const art = boss && mob_icon(boss.mob_type)
  return (
    <header className="dapp-raid-result">
      {art && <img src={art} alt="" />}
      <div>
        <h3>{text(verdict ? VERDICT_TITLES[verdict] : 'position_finished')}</h3>
        <span>{party.dungeon ? titleize(party.dungeon.dungeon) : text('activity_raid')}</span>
      </div>
    </header>
  )
}

/** The fights the team won and lost, and the keys the heroes still hold; nothing of the keys while the bag is read. */
const ResultFacts = ({ copy, party }: Result) => {
  const keys = useAppStore(({ session }) =>
    party.dungeon ? dungeon_keys(session.agent_inventory)[party.dungeon.dungeon] : undefined
  )
  const text = raid_text(copy)
  const fights = party_fights(party.positions)
  const fought = fights.won + fights.lost > 0
  if (!fought && keys === undefined) return null
  return (
    <dl className="dapp-ledger">
      {fought && (
        <div>
          <dt>{text('position_fights')}</dt>
          <dd>{text('run_results', { won: String(fights.won), lost: String(fights.lost) })}</dd>
        </div>
      )}
      {keys !== undefined && (
        <div>
          <dt>{text('raid_ledger_keys_left')}</dt>
          <dd data-raid-keys={keys}>{keys}</dd>
        </div>
      )}
    </dl>
  )
}

/** The two ways on from a finished raid: another team, or the same one while its keys last. */
const ResultActions = ({ copy, party, plan }: Result & Readonly<{ plan: () => void }>) => {
  const dapp = useAppStore((state) => state.dapp)
  const account = useAppStore((state) => state.session.agent_inventory)
  const text = raid_text(copy)
  const { dungeon } = party
  const again = raid_again(dapp, account, party, dungeon ? raid_title(text, dungeon) : text('activity_raid'))
  const short = again !== null && again.missing > 0
  return (
    <>
      {dungeon && short && <RaidKeysShort copy={copy} dungeon={dungeon} missing={again.missing} ways />}
      <footer className="dapp-raid-foot">
        <Button
          onClick={() => {
            dispatch_app({ type: 'dapp/raid_pick', pick: team_pick(party) })
            plan()
          }}
        >
          {text('raid_change_team')}
        </Button>
        {again && !short && (
          <Button
            tone="primary"
            disabled={!again.ready}
            onClick={() =>
              dispatch_app({ type: 'dapp/start', id: crypto.randomUUID(), spec: again.spec, title: again.title })
            }
          >
            {text('raid_again')}
          </Button>
        )}
      </footer>
    </>
  )
}

/** How a finished raid went, and the two ways on: the same team again, or another team. */
const ResultParty = ({ copy, party, plan }: Result & Readonly<{ plan: () => void }>) => (
  <Panel
    className="dapp-raid-party"
    data-raid-party={party.dungeon?.dungeon ?? ''}
    data-verdict={raid_verdict(party) ?? 'ended'}
  >
    <ResultHead copy={copy} party={party} />
    <ResultFacts copy={copy} party={party} />
    <ResultActions copy={copy} party={party} plan={plan} />
  </Panel>
)

/**
 * What a team's fights dropped, in a panel of its own. A running raid says where its loot will show;
 * a finished one, where it is. A finished raid that dropped nothing has no such panel.
 */
const PartyLoot = ({
  copy,
  party: { live, positions },
  inspect,
}: Readonly<{ copy: AppCopy; party: RaidParty; inspect: Inspect }>) => {
  const loot = party_loot(positions, live)
  const note = [live && !loot.length && 'raid_loot_empty', !live && 'raid_result_bag'].find(Boolean)
  if (!live && !loot.length) return null
  return (
    <Panel className="dapp-raid-panel" data-raid-loot={loot.length}>
      <section className="dapp-raid-block">
        <h3>{dapp_text(copy, 'raid_loot')}</h3>
        {note && <p className="dapp-note">{dapp_text(copy, note)}</p>}
        {loot.length > 0 && (
          <ul className="dapp-rows">
            {loot.map(({ item_type, qty }) => (
              <li key={item_type}>
                <DappItemRow item_type={item_type} value={`×${qty}`} open={() => inspect(item_type)} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </Panel>
  )
}

type PartyProps = Shared & Readonly<{ heroes: readonly Hero[]; party: RaidParty; plan: () => void }>
/** The raid block of a team: where it stands while it runs, or how it ended. A run whose dungeon is unknown has none. */
const PartyBlock = ({ copy, heroes, party, plan }: Omit<PartyProps, 'locale' | 'inspect'>) => {
  if (!party.live) return <ResultParty copy={copy} party={party} plan={plan} />
  return party.dungeon && <LiveParty copy={copy} party={party} dungeon={party.dungeon} heroes={heroes} />
}
/**
 * One team in two columns: the team on the left, the drops of its dungeon on the right. A lone
 * hero's run card stands under its raid block, with its loot beside it. The cards of several heroes
 * take both columns under them, and their loot takes the card's place: no column is left empty.
 */
const Party = ({ copy, locale, inspect, heroes, party, plan }: PartyProps) => {
  const { dungeon, live, positions } = party
  const alone = positions.length === 1
  const item: Inspect = (item_type) => inspect({ kind: 'item', item_type })
  const loot = <PartyLoot copy={copy} party={party} inspect={item} />
  const cards = positions.map((position) => (
    <DappRunCard key={position.id} copy={copy} locale={locale} position={position} />
  ))
  return (
    <section className="dapp-raid-follow" data-raid-follow={live ? 'run' : 'result'}>
      <div className="dapp-raid-split">
        <div className="dapp-raid-column">
          <PartyBlock copy={copy} heroes={heroes} party={party} plan={plan} />
          {alone ? cards : loot}
        </div>
        <div className="dapp-raid-column">
          {alone && loot}
          {dungeon && (
            <Panel className="dapp-raid-panel">
              <RaidDrops
                copy={copy}
                locale={locale}
                dungeon={dungeon}
                inspect={item}
                more={() => inspect({ kind: 'drops', dungeon: dungeon.dungeon })}
              />
            </Panel>
          )}
        </div>
      </div>
      {!alone && <div className="dapp-raid-cards">{cards}</div>}
    </section>
  )
}

/** The one sheet open over the followed raids. */
const FollowSheets = ({ copy, locale, inspect, sheet }: Shared & Readonly<{ sheet: NonNullable<FollowSheet> }>) => {
  const close = () => inspect(null)
  return sheet.kind === 'item' ? (
    <DappItemSheet copy={copy} subject={{ kind: 'type', item_type: sheet.item_type }} close={close} />
  ) : (
    <DappDropsSheet copy={copy} locale={locale} subject={{ kind: 'dungeon', dungeon: sheet.dungeon }} close={close} />
  )
}

type FollowProps = Readonly<{ copy: AppCopy; locale: Locale; plan: () => void }>
/** The followed raids over one given view state: `inspected` is the sheet that is open. */
export const RaidFollowView = ({
  copy,
  locale,
  plan,
  inspected,
  inspect,
}: FollowProps & Readonly<{ inspected: FollowSheet; inspect: (sheet: FollowSheet) => void }>) => {
  const dapp = useAppStore((state) => state.dapp)
  const heroes = useAppStore((state) => state.session.agent_inventory.characters)
  const text = raid_text(copy)
  const parties = raid_parties(dapp.positions, heroes)
  const starting = raid_starting(dapp).length > 0
  return (
    <>
      {(starting || parties.some(({ live }) => live)) && (
        <header className="dapp-raid-bar">
          <p className="dapp-note" role={starting ? 'status' : undefined} aria-busy={starting || undefined}>
            {text(starting ? 'blocker_command_pending' : 'raid_intro')}
          </p>
          <Button onClick={plan}>{text('raid_plan')}</Button>
        </header>
      )}
      {parties.map((party) => (
        <Party key={party.id} copy={copy} locale={locale} inspect={inspect} heroes={heroes} party={party} plan={plan} />
      ))}
      {inspected && <FollowSheets copy={copy} locale={locale} inspect={inspect} sheet={inspected} />}
    </>
  )
}

/** The raids the bot plays and the ones that ended. `plan` opens the setup for another team. */
export const DappRaidRun = (props: FollowProps) => {
  const [inspected, inspect] = useState<FollowSheet>(null)
  return <RaidFollowView {...props} inspected={inspected} inspect={inspect} />
}
