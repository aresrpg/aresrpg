// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// A fight quest: who goes, where, how hard, and how each hero gets there. Every figure is a seed fact
// or the chain's own rule; nothing here is an estimate or a price.
import { useRef, useState, type ReactNode, type Ref } from 'react'
import { Button, Panel, SegmentedControl } from '@aresrpg/ui'
import type { CharacterRow } from '@aresrpg/protocol'
import { difficulties, type RaidBag, type StrategyArea } from '@aresrpg/protocol/strategies'

import type { AppCopy } from '../i18n/copy.ts'
import type { Locale } from '../i18n/locale.ts'
import { dispatch_app, useAppStore } from '../store.ts'
import { mob_icon } from '../content/assets.ts'
import { content_catalog, titleize } from '../content/catalog.ts'
import { encyclopedia_text } from '../encyclopedia/copy.ts'
import type { WorldPlace } from '../encyclopedia/world_locations.ts'

import { account_bag } from './account.ts'
import { dapp_text, item_name } from './copy.ts'
import { DappDropsSheet, type DropsSubject } from './DappDropsSheet.tsx'
import { DappHeroPicker } from './DappHeroPicker.tsx'
import { DappMarketLink } from './DappMarketLink.tsx'
import { DappPotionButton, walk_time } from './DappStartParts.tsx'
import {
  city_potion,
  difficulty_fits,
  key_drops,
  place_area,
  place_levels,
  quest_places,
  quest_worlds,
  rarest_drop,
  travel_potion,
  walk_seconds,
  type PlaceDrop,
} from './places.ts'
import { fight_heroes, fight_spec, type QuestPick } from './state.ts'
import {
  held_in_kiosk,
  stands_in,
  type ActivityPlan,
  type Difficulty,
  type QuestPlace,
  type StartSpec,
} from './strategies.ts'

import './dapp_quest.css'

type Hero = Readonly<CharacterRow>
type Text = (key: string, values?: Readonly<Record<string, string>>) => string
type Open = (subject: DropsSubject) => void

/**
 * How a mode asks the tab to send its heroes: the Start of this spec under this run title. `about`
 * is what the mode itself says of the plan that Start would run, drawn above the button.
 */
export type QuestSend = (spec: StartSpec, title: string, about?: (plan: ActivityPlan) => ReactNode) => ReactNode

export const pick_quest = (pick: Partial<QuestPick>): void => dispatch_app({ type: 'dapp/quest_pick', pick })

export const mob_name = (mob_type: string): string => content_catalog.mob(mob_type)?.mob.name ?? titleize(mob_type)
const names_of = (heroes: readonly Hero[]): string => heroes.map(({ name }) => name).join(', ')
/** The place a pick names, among the places of its world that hold monsters. */
const area_place = (area: StrategyArea): WorldPlace | null =>
  quest_places(area.world).find(({ kind, id }) => (kind === 'city' ? area.city === id : area.biome === id)) ?? null
/** The city a hero stands in, when monsters live there. Outside every city a hero fights across its
 * whole world, so there is no single place to name: null. */
const standing = (hero: Hero): WorldPlace | null => {
  const world = hero.world ?? ''
  return quest_places(world).find((place) => place.kind === 'city' && stands_in(place_area(world, place), hero)) ?? null
}

type Target = Readonly<{ id: string; place: WorldPlace; heroes: readonly Hero[] }>
/**
 * The places whose monsters the heroes would meet. A chosen place is one target for all of them. With
 * none, each hero fights in the city it stands in. Outside every city, or with a difficulty and no
 * place, a hero fights across its world: the page then knows no place to describe.
 */
const fight_targets = ({ place, difficulty }: QuestPick, heroes: readonly Hero[]): readonly Target[] => {
  if (place) return [area_place(place)].flatMap((found) => (found ? [{ id: found.key, place: found, heroes }] : []))
  if (difficulty) return []
  return heroes.reduce<readonly Target[]>((targets, hero) => {
    const own = standing(hero)
    if (!own) return targets
    const id = `${hero.world}/${own.key}`
    return targets.some((target) => target.id === id)
      ? targets.map((target) => (target.id === id ? { ...target, heroes: [...target.heroes, hero] } : target))
      : [...targets, { id, place: own, heroes: [hero] }]
  }, [])
}

/** A seed rate is the base rate: the game scales it with the monster's level, so it reads "about". */
const drop_values = (locale: Locale, { item_type, mob_type, chance_bp }: PlaceDrop) => ({
  key: item_name(item_type),
  item: item_name(item_type),
  mob: mob_name(mob_type),
  rate: (chance_bp / 100).toLocaleString(locale, { maximumFractionDigits: 2 }),
})
/** One line per key: its most frequent source. The drops sheet lists every monster that drops it. */
const key_lines = (mob_types: readonly string[]): readonly PlaceDrop[] =>
  key_drops(mob_types).filter(
    (drop, index, drops) => drops.findIndex(({ item_type }) => item_type === drop.item_type) === index
  )

type Shared = Readonly<{ copy: AppCopy; locale: Locale; text: Text }>

const Monsters = ({ mob_types, open }: Readonly<{ mob_types: readonly string[]; open: Open }>) => (
  <div className="dapp-quest-mobs">
    {[...new Set(mob_types)].map((mob_type) => {
      const icon = mob_icon(mob_type)
      const name = mob_name(mob_type)
      return (
        <Button key={mob_type} aria-label={name} title={name} onClick={() => open({ kind: 'monster', mob_type })}>
          {icon ? <img src={icon} alt="" /> : name.slice(0, 1)}
        </Button>
      )
    })}
  </div>
)

/** One city or biome: its name, the level band of its monsters, who lives there and the keys it drops. */
const PlaceCard = ({
  copy,
  locale,
  text,
  place,
  pressed,
  choose,
  open,
}: Shared & Readonly<{ place: WorldPlace; pressed: boolean; choose: () => void; open: Open }>) => {
  const band = place_levels(place.mob_types)
  const kind = encyclopedia_text(copy)(place.kind === 'city' ? 'world_city' : 'world_biome')
  const levels = band && text('place_levels', { min: String(band.min), max: String(band.max) })
  return (
    <article className="dapp-quest-place" data-place={place.key} data-selected={pressed || undefined}>
      <Button className="dapp-quest-choice" aria-pressed={pressed} onClick={choose}>
        <span className="dapp-quest-choice-text">
          <b>{titleize(place.id)}</b>
          <small>{[kind, levels].filter(Boolean).join(' · ')}</small>
        </span>
      </Button>
      <Monsters mob_types={place.mob_types} open={open} />
      {key_lines(place.mob_types).map((drop) => (
        <p key={drop.item_type} className="dapp-note">
          {text('place_key_drop', drop_values(locale, drop))}
        </p>
      ))}
    </article>
  )
}

/** What a place holds for the heroes sent there: levels against theirs, the keys it drops, its rarest drop. */
const PlaceFacts = ({
  locale,
  text,
  target: { place, heroes },
  named,
  open,
}: Omit<Shared, 'copy'> & Readonly<{ target: Target; named: boolean; open: Open }>) => {
  const band = place_levels(place.mob_types)
  const range = band && { min: String(band.min), max: String(band.max) }
  const rarest = rarest_drop(place.mob_types)
  return (
    <section className="dapp-quest-facts" data-facts={place.key}>
      {named && <h3>{titleize(place.id)}</h3>}
      {range && <p className="dapp-run-line">{text('place_levels', range)}</p>}
      {heroes
        .filter(({ level }) => band !== null && level < band.min)
        .map(({ id, name, level }) => (
          <p key={id} className="dapp-run-line" data-tone="alert" role="status" data-level-warning={id}>
            {text('place_level_warning', { ...range, name, level: String(level) })}
          </p>
        ))}
      {key_lines(place.mob_types).map((drop) => (
        <p key={drop.item_type} className="dapp-run-line">
          {text('place_key_drop', drop_values(locale, drop))}
        </p>
      ))}
      {rarest && <p className="dapp-run-line">{text('place_rarest', drop_values(locale, rarest))}</p>}
      <Button onClick={() => open({ kind: 'place', place: place.id, mob_types: place.mob_types })}>
        {text('place_all_drops')}
      </Button>
    </section>
  )
}

const LEVELS = Object.keys(difficulties) as readonly Difficulty[]
/** How hard: the catalogue's three levels, or none. A level that the chosen place cannot offer says so. */
const DifficultyPick = ({
  text,
  difficulty,
  fits,
  place,
}: Readonly<{ text: Text; difficulty: Difficulty | null; fits: boolean; place: string }>) => {
  const sizes = difficulty && difficulties[difficulty]
  const hint = sizes
    ? text(sizes.min_size === sizes.max_size ? 'difficulty_hint_one' : 'difficulty_hint', {
        size: String(sizes.min_size),
        min: String(sizes.min_size),
        max: String(sizes.max_size),
      })
    : text('difficulty_none_hint')
  return (
    <div className="dapp-quest-field">
      <SegmentedControl
        label={text('difficulty_label')}
        options={[
          { value: 'none', label: text('difficulty_none') },
          ...LEVELS.map((level) => ({ value: level, label: text(`difficulty_${level}`) })),
        ]}
        value={difficulty ?? 'none'}
        on_change={(value) => pick_quest({ difficulty: value === 'none' ? null : value })}
      />
      {fits ? (
        <p className="dapp-run-line">{hint}</p>
      ) : (
        <p className="dapp-run-line" data-tone="alert" role="alert" data-unfit="">
          {text('difficulty_unfit', { city: place })}
        </p>
      )}
    </div>
  )
}

/** One hero that walks to the chosen city: how far it is at least, and its potion when it holds one. */
const Walker = ({
  copy,
  locale,
  text,
  hero,
  area,
  bag,
}: Shared & Readonly<{ hero: Hero; area: StrategyArea; bag: RaidBag | null }>) => {
  const seconds = walk_seconds(hero, area)
  const potion = bag && travel_potion(bag, hero, area)
  const held = potion && bag ? held_in_kiosk(bag, hero, potion.item_type) : 0
  const lines = [
    text('travel_needed', { name: hero.name, city: titleize(area.city ?? '') }),
    seconds !== null && text('quest_walk_time', { time: walk_time(locale, seconds) }),
    potion && text('travel_potion_held', { count: String(held), item: item_name(potion.item_type) }),
  ]
  return (
    <div className="dapp-notice-row" data-walker={hero.id}>
      <p className="dapp-run-line">{lines.filter(Boolean).join(' ')}</p>
      {potion && <DappPotionButton copy={copy} hero={hero} potion={potion} />}
    </div>
  )
}

/**
 * How the heroes arrive. Walking is a fact of the plan, never a blocker: the bot walks them first. A
 * city also has a potion: a hero that holds one may drink it, one hero at a time.
 */
const Arrival = ({
  copy,
  locale,
  text,
  plan,
  heroes,
  place,
}: Shared & Readonly<{ plan: ActivityPlan; heroes: readonly Hero[]; place: QuestPlace }>) => {
  const account = useAppStore(({ session }) => session.agent_inventory)
  const walkers = heroes.filter(({ id }) => plan.starts.some(({ hero_id, walks }) => walks && hero_id === id))
  if (!walkers.length) return null
  const bag = account_bag(account)
  const city = place?.city ? place : null
  const potion = city && city_potion(city.city!)
  const holds = (hero: Hero): boolean => bag !== null && city !== null && travel_potion(bag, hero, city) !== null
  return (
    <section className="dapp-quest-arrival" data-arrival="">
      <p className="dapp-run-line">{text('quest_walks', { names: names_of(walkers) })}</p>
      {city &&
        walkers.map((hero) => (
          <Walker key={hero.id} copy={copy} locale={locale} text={text} hero={hero} area={city} bag={bag} />
        ))}
      {potion && !walkers.some(holds) && (
        <div className="dapp-notice-row">
          <p className="dapp-run-line">{text('travel_potion_none', { item: item_name(potion) })}</p>
          <DappMarketLink copy={copy} item_type={potion} />
        </div>
      )}
    </section>
  )
}

/** What the plan is about: the chosen place by its name, and whether its difficulty can be played there. */
const plan_subject = ({ place, difficulty }: QuestPick): Readonly<{ name: string | null; fits: boolean }> => {
  if (!place) return { name: null, fits: true }
  const name = titleize(area_place(place)?.id ?? place.world)
  return { name, fits: !difficulty || difficulty_fits(place, difficulty) }
}

type PlanProps = Shared &
  Readonly<{
    quest: QuestPick
    heroes: readonly Hero[]
    spec: StartSpec
    send: QuestSend
    open: Open
    panel: Ref<HTMLElement>
  }>
/** The plan of the chosen place: how hard, what it holds for these heroes, how they arrive, and Start. */
const FightPlan = ({ copy, locale, text, quest, heroes, spec, send, open, panel }: PlanProps) => {
  const { place, difficulty } = quest
  const { name, fits } = plan_subject(quest)
  const label = name ?? text('quest_here')
  const title = name ? text('quest_run_fight', { place: name }) : text('quest_fight')
  return (
    <Panel ref={panel} className="dapp-quest-plan" aria-label={label} data-plan="fight">
      <h2>{label}</h2>
      <DifficultyPick text={text} difficulty={difficulty} fits={fits} place={label} />
      {fight_targets(quest, heroes).map((target) => (
        <PlaceFacts key={target.id} locale={locale} text={text} target={target} named={!place} open={open} />
      ))}
      <p className="dapp-run-line">{text('quest_until_stop')}</p>
      {fits &&
        send(spec, title, (plan) => (
          <Arrival copy={copy} locale={locale} text={text} plan={plan} heroes={heroes} place={place} />
        ))}
    </Panel>
  )
}

type WhereProps = Shared &
  Readonly<{
    place: QuestPlace
    heroes: readonly Hero[]
    open: Open
    /** A place was chosen: the caller shows the plan of that place, where the Start is. */
    choose: (place: QuestPlace) => void
  }>
/** Where to: each hero where it stands, or one city or biome of the world shown. */
const Places = ({
  copy,
  locale,
  text,
  world,
  place,
  heroes,
  open,
  choose,
}: WhereProps & Readonly<{ world: string }>) => (
  <div className="dapp-quest-places">
    <article className="dapp-quest-place" data-place="here" data-selected={place === null || undefined}>
      <Button className="dapp-quest-choice" aria-pressed={place === null} onClick={() => choose(null)}>
        <span className="dapp-quest-choice-text">
          <b>{text('quest_here')}</b>
          <small>
            {heroes.map((hero) => `${hero.name} · ${titleize(standing(hero)?.id ?? hero.world ?? '')}`).join(', ')}
          </small>
        </span>
      </Button>
    </article>
    {quest_places(world).map((entry) => (
      <PlaceCard
        key={entry.key}
        copy={copy}
        locale={locale}
        text={text}
        place={entry}
        pressed={place?.world === world && area_place(place)?.key === entry.key}
        choose={() => choose(place_area(world, entry))}
        open={open}
      />
    ))}
  </div>
)

/** The world shown first: the one the first hero stands in, else the first one a hero may enter. */
const first_world = (heroes: readonly Hero[], entered: readonly Readonly<{ world: string }>[]): string =>
  heroes[0]?.world ?? entered[0]?.world ?? ''

/** Where: the worlds a hero may enter, and the places of the one shown. The world shown is view state. */
const Where = ({ copy, locale, text, place, heroes, open, choose }: WhereProps) => {
  const characters = useAppStore(({ session }) => session.agent_inventory.characters)
  const [viewed, view] = useState<string | null>(null)
  const worlds = quest_worlds(characters)
  const entered = worlds.filter((entry) => entry.open)
  const world = viewed ?? place?.world ?? first_world(heroes, entered)
  return (
    <section className="dapp-quest-step">
      <h2 className="dapp-quest-caps">{text('quest_where')}</h2>
      <SegmentedControl
        label={text('quest_where')}
        options={entered.map((entry) => ({ value: entry.world, label: titleize(entry.world) }))}
        value={world}
        on_change={view}
      />
      {worlds
        .filter((entry) => !entry.open)
        .map(({ world: locked, entry_level }) => (
          <p key={locked} className="dapp-note" data-world-locked={locked}>
            {text('world_locked', { world: titleize(locked), level: String(entry_level) })}
          </p>
        ))}
      <Places
        copy={copy}
        locale={locale}
        text={text}
        world={world}
        place={place}
        heroes={heroes}
        open={open}
        choose={choose}
      />
    </section>
  )
}

/**
 * Fight for loot: several heroes may go together. The open sheet is view state; the pick itself is
 * the reducer's. The plan, with its Start, comes before the places: on one column it is reached
 * without passing every place, and a place chosen further down brings the plan back into view.
 */
export const DappQuestFight = ({
  copy,
  locale,
  send,
}: Readonly<{ copy: AppCopy; locale: Locale; send: QuestSend }>) => {
  const dapp = useAppStore((state) => state.dapp)
  const account = useAppStore(({ session }) => session.agent_inventory)
  const [sheet, open] = useState<DropsSubject | null>(null)
  const plan = useRef<HTMLElement>(null)
  const text: Text = (key, values) => dapp_text(copy, key, values)
  const { quest } = dapp
  const choose = (place: QuestPlace): void => {
    pick_quest({ place })
    // Beside the places the plan is already on screen and this moves nothing.
    plan.current?.scrollIntoView({ block: 'nearest' })
  }
  const heroes = fight_heroes(dapp, account)
  const shared: Shared = { copy, locale, text }
  return (
    <>
      <section className="dapp-quest-step">
        <h2 className="dapp-quest-caps">{text('quest_who')}</h2>
        <DappHeroPicker
          copy={copy}
          label={text('quest_who')}
          heroes={account.characters}
          selected={heroes.map(({ id }) => id)}
          multiple
          on_change={(hero_ids) => pick_quest({ hero_ids })}
        />
      </section>
      <div className="dapp-quest-split">
        <FightPlan
          {...shared}
          quest={quest}
          heroes={heroes}
          spec={fight_spec(dapp, account)}
          send={send}
          open={open}
          panel={plan}
        />
        <Where {...shared} place={quest.place} heroes={heroes} open={open} choose={choose} />
      </div>
      {sheet && <DappDropsSheet copy={copy} locale={locale} subject={sheet} close={() => open(null)} />}
    </>
  )
}
