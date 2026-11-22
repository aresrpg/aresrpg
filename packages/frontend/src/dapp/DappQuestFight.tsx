// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// A fight quest: who goes, where, and the plan of the place once one is picked. Every figure is a seed
// fact or the chain's own rule; nothing here is an estimate or a price.
import { useState, type ReactNode, type Ref } from 'react'
import { Button, Panel, SegmentedControl } from '@aresrpg/ui'
import type { CharacterRow } from '@aresrpg/protocol'
import { difficulties, type RaidBag, type StrategyArea } from '@aresrpg/protocol/strategies'
import { Landmark, MapPin, Trees } from 'lucide-react'

import type { AppCopy } from '../i18n/copy.ts'
import type { Locale } from '../i18n/locale.ts'
import { useAppStore } from '../store.ts'
import { item_icon, mob_icon } from '../content/assets.ts'
import { titleize } from '../content/catalog.ts'
import { encyclopedia_text } from '../encyclopedia/copy.ts'
import type { WorldPlace } from '../encyclopedia/world_locations.ts'

import { account_bag } from './account.ts'
import { dapp_text, item_name } from './copy.ts'
import { DappDropsSheet, type DropsSubject } from './DappDropsSheet.tsx'
import { DappHeroPicker } from './DappHeroPicker.tsx'
import { DappMarketLink } from './DappMarketLink.tsx'
import {
  mob_name,
  pick_quest,
  PlanRow,
  QuestSplit,
  range_text,
  usePlanInView,
  type QuestSend,
} from './DappQuestParts.tsx'
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
type Rated = Omit<Shared, 'copy'> & Readonly<{ drop: PlaceDrop }>

/** An item and its seed rate, as short as it reads: the picture, the name, "~3%". */
const DropRate = ({ locale, text, drop }: Rated) => {
  const icon = item_icon(drop.item_type)
  const share = (drop.chance_bp / 10_000).toLocaleString(locale, { style: 'percent', maximumFractionDigits: 2 })
  return (
    <>
      {icon && <img src={icon} alt="" />}
      <span>{item_name(drop.item_type)}</span>
      <b>{text('about', { value: share })}</b>
    </>
  )
}

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

const KIND_ICON: Readonly<Record<WorldPlace['kind'], ReactNode>> = {
  city: <Landmark size={12} aria-hidden="true" />,
  biome: <Trees size={12} aria-hidden="true" />,
}
/** The key a place drops most, on one line. A place with more keys counts the others; the plan lists them. */
const KeyLine = ({ locale, text, drops }: Omit<Shared, 'copy'> & Readonly<{ drops: readonly PlaceDrop[] }>) => {
  const [first, ...others] = drops
  if (!first) return null
  return (
    <p className="dapp-quest-keyline" data-key-drop={first.item_type}>
      <DropRate locale={locale} text={text} drop={first} />
      {others.length > 0 && <small>+{others.length}</small>}
    </p>
  )
}

/**
 * One city or biome: its name, its kind, the level band of its monsters, who lives there and the key
 * it drops. A city and a biome differ by their mark, their chip and their edge, never by colour alone.
 * Which monster drops each key, and how often, is the card's tooltip.
 */
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
  const keys = key_lines(place.mob_types)
  return (
    <article
      className="dapp-quest-place"
      data-place={place.key}
      data-kind={place.kind}
      data-selected={pressed || undefined}
      title={keys.map((drop) => text('place_key_drop', drop_values(locale, drop))).join('\n') || undefined}
    >
      <Button className="dapp-quest-place-pick" aria-pressed={pressed} onClick={choose}>
        <b>{titleize(place.id)}</b>
        <span className="dapp-quest-kind">
          {KIND_ICON[place.kind]}
          {kind}
        </span>
        <small>{band && text('place_levels', { min: String(band.min), max: String(band.max) })}</small>
      </Button>
      <Monsters mob_types={place.mob_types} open={open} />
      <KeyLine locale={locale} text={text} drops={keys} />
    </article>
  )
}

/** The size of the groups a difficulty meets, by the catalogue. No difficulty meets any group. */
const GroupRow = ({ text, difficulty }: Readonly<{ text: Text; difficulty: Difficulty | null }>) => {
  if (!difficulty)
    return (
      <PlanRow label={text('plan_group')} hint={text('difficulty_none_hint')} data-group="none">
        {text('difficulty_none')}
      </PlanRow>
    )
  const { min_size, max_size } = difficulties[difficulty]
  const sizes = { size: String(min_size), min: String(min_size), max: String(max_size) }
  const hint = text(min_size === max_size ? 'difficulty_hint_one' : 'difficulty_hint', sizes)
  return (
    <PlanRow label={text('plan_group')} hint={hint} data-group={difficulty}>
      {range_text(text, min_size, max_size)}
    </PlanRow>
  )
}

/** What a place holds for the heroes sent there: levels against theirs, group size, its keys, its rarest drop. */
const PlaceFacts = ({
  locale,
  text,
  target: { place, heroes },
  difficulty,
  named,
}: Omit<Shared, 'copy'> & Readonly<{ target: Target; difficulty: Difficulty | null; named: boolean }>) => {
  const band = place_levels(place.mob_types)
  const range = band && { min: String(band.min), max: String(band.max) }
  const rarest = rarest_drop(place.mob_types)
  return (
    <section className="dapp-quest-facts" data-facts={place.key}>
      {named && <h3>{titleize(place.id)}</h3>}
      <dl className="dapp-quest-ledger">
        {band && <PlanRow label={text('plan_levels')}>{range_text(text, band.min, band.max)}</PlanRow>}
        {heroes
          .filter(({ level }) => band !== null && level < band.min)
          .map(({ id, name, level }) => (
            <PlanRow
              key={id}
              label={name}
              hint={text('place_level_warning', { ...range, name, level: String(level) })}
              data-tone="alert"
              role="status"
              data-level-warning={id}
            >
              {text('hero_level', { level: String(level) })}
            </PlanRow>
          ))}
        <GroupRow text={text} difficulty={difficulty} />
        {key_lines(place.mob_types).map((drop) => (
          <PlanRow
            key={drop.item_type}
            label={text('plan_key')}
            hint={text('place_key_drop', drop_values(locale, drop))}
          >
            <DropRate locale={locale} text={text} drop={drop} />
          </PlanRow>
        ))}
        {rarest && (
          <PlanRow label={text('plan_rarest')} hint={text('place_rarest', drop_values(locale, rarest))}>
            <DropRate locale={locale} text={text} drop={rarest} />
          </PlanRow>
        )}
      </dl>
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
}: Readonly<{ text: Text; difficulty: Difficulty | null; fits: boolean; place: string }>) => (
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
    {!fits && (
      <p className="dapp-run-line" data-tone="alert" role="alert" data-unfit="">
        {text('difficulty_unfit', { city: place })}
      </p>
    )}
  </div>
)

type Walking = Shared & Readonly<{ hero: Hero; area: StrategyArea; bag: RaidBag | null }>
/** The potion a walking hero holds for the chosen city, as the one button that drinks it. */
const Sip = ({ copy, text, hero, area, bag }: Omit<Walking, 'locale'>) => {
  const potion = bag && travel_potion(bag, hero, area)
  if (!bag || !potion) return null
  const held = String(held_in_kiosk(bag, hero, potion.item_type))
  return (
    <span title={text('travel_potion_held', { count: held, item: item_name(potion.item_type) })}>
      <DappPotionButton copy={copy} hero={hero} potion={potion} />
    </span>
  )
}
/** One hero that walks to the chosen place: how far it is at least, and its potion when it holds one. */
const Walker = ({ copy, locale, text, hero, area, bag, named }: Walking & Readonly<{ named: boolean }>) => {
  const seconds = walk_seconds(hero, area)
  const place = titleize(area.city ?? area.biome ?? area.world)
  const label = named ? `${text('plan_arrive')} · ${hero.name}` : text('plan_arrive')
  const hint = `${text('travel_needed', { name: hero.name, city: place })} ${text('quest_walks', { names: hero.name })}`
  return (
    <PlanRow label={label} hint={hint} data-walker={hero.id}>
      <span>{seconds === null ? text('plan_walk_far') : text('plan_walk', { time: walk_time(locale, seconds) })}</span>
      <Sip copy={copy} text={text} hero={hero} area={area} bag={bag} />
    </PlanRow>
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
  if (!walkers.length || !place) return null
  const bag = account_bag(account)
  const potion = place.city ? city_potion(place.city) : null
  const holds = (hero: Hero): boolean => bag !== null && travel_potion(bag, hero, place) !== null
  return (
    <dl className="dapp-quest-ledger" data-arrival="">
      {walkers.map((hero) => (
        <Walker
          key={hero.id}
          copy={copy}
          locale={locale}
          text={text}
          hero={hero}
          area={place}
          bag={bag}
          named={heroes.length > 1}
        />
      ))}
      {potion && !walkers.some(holds) && (
        <PlanRow label={text('plan_potion')} hint={text('travel_potion_none', { item: item_name(potion) })}>
          <DappMarketLink copy={copy} item_type={potion} />
        </PlanRow>
      )}
    </dl>
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
  const targets = fight_targets(quest, heroes)
  const facts = targets.length ? (
    targets.map((target) => (
      <PlaceFacts key={target.id} locale={locale} text={text} target={target} difficulty={difficulty} named={!place} />
    ))
  ) : (
    <dl className="dapp-quest-ledger">
      <GroupRow text={text} difficulty={difficulty} />
    </dl>
  )
  const links = targets.map(({ id, place: found }) => (
    <Button
      key={id}
      className="dapp-quest-link"
      data-drops={found.key}
      onClick={() => open({ kind: 'place', place: found.id, mob_types: found.mob_types })}
    >
      {targets.length > 1 ? `${text('place_all_drops')} · ${titleize(found.id)}` : text('place_all_drops')}
    </Button>
  ))
  return (
    <Panel ref={panel} className="dapp-quest-plan" aria-label={label} data-plan="fight">
      <h2>{label}</h2>
      <DifficultyPick text={text} difficulty={difficulty} fits={fits} place={label} />
      {fits ? (
        send(spec, title, {
          rows: (plan) => (
            <>
              {facts}
              <Arrival copy={copy} locale={locale} text={text} plan={plan} heroes={heroes} place={place} />
            </>
          ),
          link: links,
        })
      ) : (
        <>
          <div className="dapp-quest-ledgers">{facts}</div>
          <div className="dapp-quest-foot">{links}</div>
        </>
      )}
    </Panel>
  )
}

const HERE = 'here'
type WhereProps = Shared &
  Readonly<{
    place: QuestPlace
    /** The entry the plan belongs to: a place of the world shown, where each hero stands, or none. */
    chosen: string | null
    heroes: readonly Hero[]
    open: Open
    choose: (key: string, place: QuestPlace) => void
    plan: ReactNode
  }>
/** Where each hero stands, as one choice of the list: who is where, in one line. */
const HereCard = ({
  text,
  heroes,
  pressed,
  choose,
}: Readonly<{ text: Text; heroes: readonly Hero[]; pressed: boolean; choose: () => void }>) => (
  <article className="dapp-quest-place" data-place={HERE} data-selected={pressed || undefined}>
    <Button className="dapp-quest-place-pick" aria-pressed={pressed} onClick={choose}>
      <b>{text('quest_here')}</b>
      <MapPin size={16} aria-hidden="true" />
      <small>
        {heroes.map((hero) => `${hero.name} · ${titleize(standing(hero)?.id ?? hero.world ?? '')}`).join(', ')}
      </small>
    </Button>
  </article>
)

/** The places in the order a hero grows through them: the lowest monsters first, as the level bands read. */
const by_levels = (places: readonly WorldPlace[]): readonly WorldPlace[] =>
  places
    .map((place) => ({ place, band: place_levels(place.mob_types) ?? { min: 0, max: 0 } }))
    .toSorted((left, right) => left.band.min - right.band.min || left.band.max - right.band.max)
    .map(({ place }) => place)
/** The world shown first: the one the first hero stands in, else the first one a hero may enter. */
const first_world = (heroes: readonly Hero[], entered: readonly Readonly<{ world: string }>[]): string =>
  heroes[0]?.world ?? entered[0]?.world ?? ''

/**
 * Where: the worlds a hero may enter, the places of the one shown, and the plan of the place chosen.
 * The world shown is view state.
 */
const Where = ({ copy, locale, text, place, chosen, heroes, open, choose, plan }: WhereProps) => {
  const characters = useAppStore(({ session }) => session.agent_inventory.characters)
  const [viewed, view] = useState<string | null>(null)
  const worlds = quest_worlds(characters)
  const entered = worlds.filter((entry) => entry.open)
  const world = viewed ?? place?.world ?? first_world(heroes, entered)
  const here = {
    key: HERE,
    node: <HereCard text={text} heroes={heroes} pressed={chosen === HERE} choose={() => choose(HERE, null)} />,
  }
  const places = by_levels(quest_places(world)).map((entry) => ({
    key: `${world}/${entry.key}`,
    node: (
      <PlaceCard
        copy={copy}
        locale={locale}
        text={text}
        place={entry}
        pressed={chosen === `${world}/${entry.key}`}
        choose={() => choose(`${world}/${entry.key}`, place_area(world, entry))}
        open={open}
      />
    ),
  }))
  return (
    <section className="dapp-quest-step">
      <header className="dapp-quest-where">
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
      </header>
      <QuestSplit entries={[here, ...places]} chosen={chosen} plan={plan} hint={text('quest_pick_place')} />
    </section>
  )
}

/** The entry of the list a pick stands for: its place, or where each hero stands once the player chose that. */
const chosen_entry = ({ place }: QuestPick, here: boolean): string | null => {
  if (!place) return here ? HERE : null
  return `${place.world}/${area_place(place)?.key ?? ''}`
}

type FightProps = Readonly<{ copy: AppCopy; locale: Locale; send: QuestSend }>
/**
 * Fight for loot: several heroes may go together. Nothing about a place shows before the player picks
 * one: its plan, with the difficulty, the fee limit and the Start, opens with the pick. A place is the
 * reducer's pick; "where each hero stands" is the pick with no place, so that the player chose it is
 * view state (`here`).
 */
export const QuestFightView = ({
  copy,
  locale,
  send,
  here,
  set_here,
}: FightProps & Readonly<{ here: boolean; set_here: (here: boolean) => void }>) => {
  const dapp = useAppStore((state) => state.dapp)
  const account = useAppStore(({ session }) => session.agent_inventory)
  const [sheet, open] = useState<DropsSubject | null>(null)
  const text: Text = (key, values) => dapp_text(copy, key, values)
  const { quest } = dapp
  const chosen = chosen_entry(quest, here)
  const panel = usePlanInView(chosen)
  // Choosing the chosen entry again closes its plan: the tab is back to nothing picked.
  const choose = (key: string, place: QuestPlace): void => {
    const closes = key === chosen
    set_here(!closes && place === null)
    pick_quest({ place: closes ? null : place })
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
      <Where
        {...shared}
        place={quest.place}
        chosen={chosen}
        heroes={heroes}
        open={open}
        choose={choose}
        plan={
          chosen !== null && (
            <FightPlan
              {...shared}
              quest={quest}
              heroes={heroes}
              spec={fight_spec(dapp, account)}
              send={send}
              open={open}
              panel={panel}
            />
          )
        }
      />
      {sheet && <DappDropsSheet copy={copy} locale={locale} subject={sheet} close={() => open(null)} />}
    </>
  )
}
export const DappQuestFight = (props: FightProps) => {
  const [here, set_here] = useState(false)
  return <QuestFightView {...props} here={here} set_here={set_here} />
}
