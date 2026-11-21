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
import { DappItemRow, DappItemSheet } from './DappItemSheet.tsx'
import { DappMarketLink } from './DappMarketLink.tsx'
import { DappRunCard } from './DappRunCard.tsx'
import { dungeon_keys } from './next_step.ts'
import { dungeon_rooms } from './places.ts'
import {
  drop_rooms,
  dungeon_boss,
  key_quest_inputs,
  NEXT_DROPS_SHOWN,
  party_fights,
  party_loot,
  raid_again,
  raid_parties,
  raid_starting,
  raid_text,
  raid_title,
  raid_verdict,
  room_drops,
  room_title,
  team_pick,
  type RaidDrop,
  type RaidLoot,
  type RaidParty,
  type RaidVerdict,
} from './raid.ts'
import { hero_command } from './state.ts'

import './dapp_raid.css'

type Hero = Readonly<CharacterRow>

/**
 * Drops as rows: the item, where it drops when a dungeon is given, and the seed's base rate. The game
 * scales that rate with the monster's level, so it reads "about".
 */
export const RaidDropRows = ({
  copy,
  locale,
  drops,
  dungeon,
  inspect,
}: Readonly<{
  copy: AppCopy
  locale: Locale
  drops: readonly RaidDrop[]
  dungeon?: SeedDungeon
  inspect: (item_type: string) => void
}>) => (
  <ul className="dapp-rows">
    {drops.map(({ item_type, chance_bp, rooms }) => (
      <li key={item_type}>
        <DappItemRow
          item_type={item_type}
          detail={dungeon && `· ${drop_rooms(raid_text(copy), dungeon, rooms)}`}
          value={dapp_text(copy, 'drops_rate', {
            rate: (chance_bp / 100).toLocaleString(locale, { maximumFractionDigits: 2 }),
          })}
          open={() => inspect(item_type)}
        />
      </li>
    ))}
  </ul>
)

/**
 * A team short of keys: how many it lacks, and the two honest ways to get them. Outside the market
 * there is no price, so the key links to its listings; quests drop it.
 */
export const RaidKeysShort = ({
  copy,
  dungeon,
  missing,
}: Readonly<{ copy: AppCopy; dungeon: SeedDungeon; missing: number }>) => (
  <div className="dapp-raid-short" data-raid-short={missing}>
    <strong>{dapp_text(copy, 'raid_keys_short', { count: String(missing), item: item_name(dungeon.key) })}</strong>
    <div className="dapp-raid-actions">
      <DappMarketLink copy={copy} item_type={dungeon.key} />
      <Button onClick={() => key_quest_inputs(dungeon.key).forEach(dispatch_app)}>
        {dapp_text(copy, 'raid_quest_for_keys')}
      </Button>
    </div>
  </div>
)

type Shared = Readonly<{ copy: AppCopy; locale: Locale; inspect: (item_type: string) => void }>

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

const LootRows = ({ loot, inspect }: Readonly<{ loot: readonly RaidLoot[]; inspect: Shared['inspect'] }>) => (
  <ul className="dapp-rows">
    {loot.map(({ item_type, qty }) => (
      <li key={item_type}>
        <DappItemRow item_type={item_type} value={`×${qty}`} open={() => inspect(item_type)} />
      </li>
    ))}
  </ul>
)

/** The room a hero stands in, from its own chain row; null while it is outside that dungeon. */
const room_of = ({ dungeon_run }: Hero, dungeon: SeedDungeon): number | null =>
  dungeon_run?.dungeon === dungeon.dungeon ? dungeon_run.room : null

/**
 * A raid in progress: the room each hero stands in, the loot of the rooms behind and what the room
 * ahead can drop. Stop ends the bot's play and keeps the hero inside its run; leaving is another act.
 */
const LiveParty = ({
  copy,
  locale,
  inspect,
  party,
  dungeon,
  heroes,
}: Shared & Readonly<{ party: RaidParty; dungeon: SeedDungeon; heroes: readonly Hero[] }>) => {
  const dapp = useAppStore((state) => state.dapp)
  const text = raid_text(copy)
  const team = heroes.filter(({ id }) => party.positions.some(({ hero_id }) => hero_id === id))
  const rooms = team.flatMap((hero) => room_of(hero, dungeon) ?? [])
  const now = rooms.length ? Math.max(...rooms) : null
  const where = now === null ? text('raid_walking') : room_title(text, dungeon, now)
  // Outside the dungeon the first room is ahead; inside, the one after the room the team stands in.
  const ahead = dungeon_rooms(dungeon)[now ?? 0]
  const loot = party_loot(party.positions, true)
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
      <section className="dapp-raid-block">
        <h4>{text('raid_loot')}</h4>
        {loot.length ? (
          <LootRows loot={loot} inspect={inspect} />
        ) : (
          <p className="dapp-note">{text('raid_loot_empty')}</p>
        )}
      </section>
      {ahead && (
        <section className="dapp-raid-block">
          <h4>{text('raid_next_drops')}</h4>
          <RaidDropRows
            copy={copy}
            locale={locale}
            drops={room_drops([ahead]).slice(0, NEXT_DROPS_SHOWN)}
            inspect={inspect}
          />
        </section>
      )}
      <footer className="dapp-raid-foot">
        <p className="dapp-note">{text('raid_stop_note')}</p>
        <Button
          disabled={!stoppable.length}
          onClick={() => dispatch_app({ type: 'dapp/stop', id: crypto.randomUUID(), hero_ids: stoppable })}
        >
          {text('raid_stop_team')}
        </Button>
      </footer>
    </Panel>
  )
}

const VERDICT_TITLES: Readonly<Record<NonNullable<RaidVerdict>, string>> = {
  won: 'raid_result_won',
  lost: 'raid_result_lost',
}
type Result = Readonly<{ copy: AppCopy; party: RaidParty }>

/** How the raid went, in one word, under its boss. A raid that ended undecided is only "finished". */
const ResultHead = ({ copy, party }: Result) => {
  const text = raid_text(copy)
  const verdict = raid_verdict(party)
  const boss = party.dungeon && dungeon_boss(party.dungeon)
  const art = boss && mob_icon(boss.mob_type)
  const fights = party_fights(party.positions)
  return (
    <>
      <header className="dapp-raid-result">
        {art && <img src={art} alt="" />}
        <h3>{text(verdict ? VERDICT_TITLES[verdict] : 'position_finished')}</h3>
        <span>{party.dungeon ? titleize(party.dungeon.dungeon) : text('activity_raid')}</span>
      </header>
      {fights.won + fights.lost > 0 && (
        <p className="dapp-note">{text('run_results', { won: String(fights.won), lost: String(fights.lost) })}</p>
      )}
    </>
  )
}

/** The keys the heroes still hold for a dungeon; nothing while the bag is being read. */
const KeysLeft = ({ copy, dungeon }: Readonly<{ copy: AppCopy; dungeon: SeedDungeon }>) => {
  const keys = useAppStore(({ session }) => dungeon_keys(session.agent_inventory)[dungeon.dungeon])
  return keys === undefined ? null : (
    <p className="dapp-raid-keys" data-raid-keys={keys}>
      {dapp_text(copy, 'raid_keys_left', { count: String(keys) })}
    </p>
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
      {dungeon && <KeysLeft copy={copy} dungeon={dungeon} />}
      {dungeon && short && <RaidKeysShort copy={copy} dungeon={dungeon} missing={again.missing} />}
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

/** What a finished raid brought back, and the two ways on: the same team again, or another team. */
const ResultParty = ({
  copy,
  inspect,
  party,
  plan,
}: Result & Readonly<{ inspect: Shared['inspect']; plan: () => void }>) => {
  const loot = party_loot(party.positions, false)
  return (
    <Panel
      className="dapp-raid-party"
      data-raid-party={party.dungeon?.dungeon ?? ''}
      data-verdict={raid_verdict(party) ?? 'ended'}
    >
      <ResultHead copy={copy} party={party} />
      {loot.length > 0 && (
        <section className="dapp-raid-block">
          <p className="dapp-note">{dapp_text(copy, 'raid_result_bag')}</p>
          <LootRows loot={loot} inspect={inspect} />
        </section>
      )}
      <ResultActions copy={copy} party={party} plan={plan} />
    </Panel>
  )
}

/** One team: its raid block when the dungeon is known, then one run card per hero with its own Stop. */
const Party = ({
  heroes,
  party,
  plan,
  ...shared
}: Shared & Readonly<{ heroes: readonly Hero[]; party: RaidParty; plan: () => void }>) => (
  <section className="dapp-raid-follow" data-raid-follow={party.live ? 'run' : 'result'}>
    {party.live && party.dungeon && <LiveParty {...shared} party={party} dungeon={party.dungeon} heroes={heroes} />}
    {!party.live && <ResultParty copy={shared.copy} inspect={shared.inspect} party={party} plan={plan} />}
    <div className="dapp-raid-cards">
      {party.positions.map((position) => (
        <DappRunCard key={position.id} copy={shared.copy} locale={shared.locale} position={position} />
      ))}
    </div>
  </section>
)

type FollowProps = Readonly<{ copy: AppCopy; locale: Locale; plan: () => void }>
/** The followed raids over one given view state: `inspected` is the item whose sheet is open. */
export const RaidFollowView = ({
  copy,
  locale,
  plan,
  inspected,
  inspect,
}: FollowProps & Readonly<{ inspected: string | null; inspect: (item_type: string | null) => void }>) => {
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
      {inspected && (
        <DappItemSheet copy={copy} subject={{ kind: 'type', item_type: inspected }} close={() => inspect(null)} />
      )}
    </>
  )
}

/** The raids the bot plays and the ones that ended. `plan` opens the setup for another team. */
export const DappRaidRun = (props: FollowProps) => {
  const [inspected, inspect] = useState<string | null>(null)
  return <RaidFollowView {...props} inspected={inspected} inspect={inspect} />
}
