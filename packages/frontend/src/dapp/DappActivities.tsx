// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { Button, GameWindow, NativeModal } from '@aresrpg/ui'
import type { StatName } from '@aresrpg/immutable'
import type { CharacterRow } from '@aresrpg/protocol'
import { Pickaxe, Swords, Castle } from 'lucide-react'
import { useEffect, useMemo, useState, type ReactNode } from 'react'

import { spell_name, stat_name, type AppCopy } from '../i18n/copy.ts'
import { dispatch_app, useAppStore } from '../store.ts'
import { items_by_type } from '../content/items.ts'
import type { MarketFloor } from '../marketplace/floor_state.ts'
import { MARKET_GROUPS, market_categories } from '../modules/marketplace.ts'
import { titleize } from '../content/catalog.ts'

import { dapp_error, dapp_text, item_name } from './copy.ts'
import { BASIC, type Blocker, type DappActivity } from './strategies.ts'
import { activity_offer, type DappMode } from './state.ts'

const ACTIVITIES: readonly Readonly<{ activity: DappActivity; icon: ReactNode }>[] = [
  { activity: 'train', icon: <Swords size={22} aria-hidden="true" /> },
  { activity: 'gather', icon: <Pickaxe size={22} aria-hidden="true" /> },
  { activity: 'raid', icon: <Castle size={22} aria-hidden="true" /> },
]
const BLOCKERS: readonly Blocker[] = [
  'hero_busy',
  'hero_unknown',
  'city_required',
  'world_required',
  'key_missing',
  'team_full',
]
/** One cached empty list: a selector must return the same reference while nothing is observed. */
const NONE: readonly never[] = Object.freeze([])
const names_of = (heroes: readonly CharacterRow[]): string => heroes.map(({ name }) => name).join(', ')

/** Where the market lists one item type: the group and category its own catalogue row names. */
const market_listing = (item_type: string) =>
  MARKET_GROUPS.flatMap((group) =>
    market_categories(group)
      .filter((category) => category === items_by_type[item_type]?.category)
      .map((category) => ({ group, category, item_type }))
  )[0] ?? null
/** The floor read of this item came back with no public listing at all. */
const nobody_sells = (floor: MarketFloor | null, item_type: string): boolean =>
  floor !== null &&
  [floor.item_type === item_type, floor.status === 'ready', !Object.keys(floor.prices).length].every(Boolean)

/**
 * Outside the market there is no price and no purchase: a missing key links to its listing there,
 * or says plainly that nobody sells it. The one floor read tells which, and shows no price.
 */
const KeyFix = ({ copy, item_type, count }: Readonly<{ copy: AppCopy; item_type: string; count: number }>) => {
  const unsold = useAppStore(({ marketplace }) => nobody_sells(marketplace.floor, item_type))
  useEffect(() => {
    dispatch_app({ type: 'market/floor_selected', item_type })
    return () => dispatch_app({ type: 'market/floor_selected', item_type: null })
  }, [item_type])
  const listing = market_listing(item_type)
  const item = item_name(item_type)
  return (
    <div className="dapp-fix">
      <p>{dapp_text(copy, 'key_missing', { count: String(count), item })}</p>
      {listing && !unsold ? (
        <Button
          onClick={() => {
            dispatch_app({ type: 'market/group_selected', ...listing })
            dispatch_app({ type: 'dapp/view', view: 'market' })
          }}
        >
          {dapp_text(copy, 'key_find', { item })}
        </Button>
      ) : (
        <p>{dapp_text(copy, 'key_unsold', { item })}</p>
      )}
    </div>
  )
}

type Text = (key: string, values?: Readonly<Record<string, string>>) => string
type Offer = Readonly<ReturnType<typeof activity_offer>>
/** What a card says about the heroes in its scope, in the order a player can act on it. */
const offer_lines = (text: Text, { out, free, sending, plan }: Offer) => {
  const named = (ids: readonly string[]) => names_of(free.filter(({ id }) => ids.includes(id)))
  const ready = named(plan.starts.map(({ hero_id }) => hero_id))
  const blocked = BLOCKERS.map((blocker) => {
    const names = named(plan.blocked.flatMap((entry) => (entry.blocker === blocker ? [entry.hero_id] : [])))
    return { shown: Boolean(names), key: blocker, line: text(`blocker_${blocker}`, { names }) }
  })
  // Free heroes with neither a tree nor a reason mean the bot itself is not ready for a start.
  const unanswered = [free.length > 0, !ready, blocked.every(({ shown }) => !shown)].every(Boolean)
  return [
    { shown: out.length > 0, key: 'out', line: text('activity_out', { names: names_of(out) }) },
    { shown: Boolean(ready), key: 'ready', line: text('activity_ready', { names: ready }) },
    ...blocked,
    { shown: sending || unanswered, key: 'waiting', line: text('blocker_command_pending') },
    { shown: [!free.length, !out.length, !sending].every(Boolean), key: 'idle', line: text('blocker_no_free_hero') },
  ].filter(({ shown }) => shown)
}

/**
 * Too few keys for the whole team: the player reads who enters and how to get the missing keys, then
 * chooses. Nothing is sent before that choice.
 */
const RaidNotice = ({
  text,
  names,
  count,
  fixes,
  proceed,
  cancel,
}: Readonly<{
  text: Text
  names: string
  count: string
  fixes: ReactNode
  proceed: () => void
  cancel: () => void
}>) => (
  <NativeModal close={cancel} label={text('raid_short_title')} className="aui-modal-scrim">
    <GameWindow
      title={text('raid_short_title')}
      close={cancel}
      close_label={text('close')}
      className="aui-confirm dapp-confirm"
    >
      <div className="dapp-confirm-body">
        <p>{text('raid_short_body', { count, names })}</p>
        {fixes}
      </div>
      <div className="aui-confirm-actions">
        <Button onClick={cancel}>{text('cancel')}</Button>
        <Button tone="primary" onClick={proceed}>
          {text('raid_short_action', { count })}
        </Button>
      </div>
    </GameWindow>
  </NativeModal>
)

/** Basic raids the seed's dungeon with the strongest heroes; every other card says the same in both modes. */
const activity_body = (text: Text, activity: DappActivity, mode: DappMode): string =>
  activity === 'raid' && mode === 'basic'
    ? text('activity_raid_body_basic', { dungeon: titleize(BASIC.dungeon), size: String(BASIC.team) })
    : text(`activity_${activity}_body`)

const ActivityCard = ({
  copy,
  activity,
  icon,
  hero_ids,
}: Readonly<{ copy: AppCopy; activity: DappActivity; icon: ReactNode; hero_ids: readonly string[] }>) => {
  const dapp = useAppStore((state) => state.dapp)
  const account = useAppStore((state) => state.session.agent_inventory)
  const [confirming, set_confirming] = useState(false)
  const text: Text = (key, values) => dapp_text(copy, key, values)
  const title = text(`activity_${activity}`)
  const offer = useMemo(
    () => activity_offer(dapp, account, activity, hero_ids, title),
    [dapp, account, activity, hero_ids, title]
  )
  const { out, free, sending, plan } = offer
  // A raid that leaves heroes behind for want of keys is confirmed first.
  const short = plan.starts.length > 0 && Object.keys(plan.missing_keys).length > 0
  const start = () => {
    set_confirming(false)
    dispatch_app({ type: 'dapp/start', id: crypto.randomUUID(), activity, hero_ids, title })
  }
  const fixes = Object.entries(plan.missing_keys).map(([item_type, count]) => (
    <KeyFix key={item_type} copy={copy} item_type={item_type} count={count} />
  ))
  const entering = free.filter(({ id }) => plan.starts.some(({ hero_id }) => hero_id === id))
  return (
    <article className="dapp-activity" data-activity={activity}>
      <header>
        {icon}
        <h3>{title}</h3>
      </header>
      <p>{activity_body(text, activity, dapp.mode)}</p>
      <ul className="dapp-activity-state" aria-live="polite">
        {offer_lines(text, offer).map(({ key, line }) => (
          <li key={key} data-line={key}>
            {line}
          </li>
        ))}
      </ul>
      {confirming && short ? (
        <RaidNotice
          text={text}
          names={names_of(entering)}
          count={String(entering.length)}
          fixes={fixes}
          proceed={start}
          cancel={() => set_confirming(false)}
        />
      ) : (
        fixes
      )}
      <footer>
        {(free.length > 0 || sending) && (
          <Button
            tone="primary"
            busy={sending}
            disabled={!plan.starts.length}
            onClick={short ? () => set_confirming(true) : start}
          >
            {text(`activity_${activity}_action`)}
          </Button>
        )}
        {out.length > 0 && (
          <Button
            onClick={() =>
              dispatch_app({ type: 'dapp/stop', id: crypto.randomUUID(), hero_ids: out.map(({ id }) => id) })
            }
          >
            {text('position_stop')}
          </Button>
        )}
      </footer>
    </article>
  )
}

/** A refusal names its heroes once per reason; an unknown answer is one calm notice for all of them. */
const CommandNotices = ({ copy }: Readonly<{ copy: AppCopy }>) => {
  const commands = useAppStore(({ dapp }) => dapp.commands)
  const heroes = useAppStore(({ session }) => session.agent_inventory.characters)
  const list = Object.values(commands)
  const reasons = [...new Set(list.flatMap(({ status, error }) => (status === 'refused' ? [error ?? 'unknown'] : [])))]
  return (
    <>
      {list.some(({ status }) => status === 'uncertain') && (
        <p className="dapp-warning" role="status">
          {dapp_text(copy, 'command_uncertain')}
        </p>
      )}
      {reasons.map((reason) => {
        const refused = list.filter(({ status, error }) => status === 'refused' && (error ?? 'unknown') === reason)
        const names = names_of(heroes.filter(({ id }) => refused.some(({ hero_id }) => hero_id === id)))
        return (
          <p key={reason} className="dapp-error" role="alert">
            {dapp_text(copy, 'command_refused', { names, reason: dapp_error(copy, reason) })}
          </p>
        )
      })}
    </>
  )
}

/** Basic grows heroes of the seed's class by itself; the player reads what it will spend and wear. */
const build_note = (copy: AppCopy): string =>
  dapp_text(copy, 'activities_build', {
    classe: copy.simulator_page[`class_${BASIC.classe}_title`] ?? titleize(BASIC.classe),
    stat: BASIC.stats!.map((stat) => stat_name(copy, stat as StatName)).join(', '),
    spell: spell_name(copy, BASIC.spells![0]!),
  })

/** Basic sends every free hero at once; Advanced acts on the selected hero alone. */
export const DappActivities = ({ copy }: Readonly<{ copy: AppCopy }>) => {
  const heroes = useAppStore(({ session }) => session.agent_inventory.characters)
  const basic = useAppStore(({ dapp }) => dapp.mode === 'basic')
  const selected = useAppStore(({ dapp }) => (dapp.mode === 'advanced' ? dapp.hero_id : null))
  const hero_ids = useMemo(() => (selected ? [selected] : heroes.map(({ id }) => id)), [selected, heroes])
  const name = heroes.find(({ id }) => id === selected)?.name
  return (
    <section className="dapp-section" aria-label={dapp_text(copy, 'activities_title')}>
      <h2>{dapp_text(copy, 'activities_title')}</h2>
      <p className="dapp-note">
        {name ? dapp_text(copy, 'activities_hero', { name }) : dapp_text(copy, 'activities_team')}
      </p>
      {basic && <p className="dapp-note">{build_note(copy)}</p>}
      <CommandNotices copy={copy} />
      <div className="dapp-activities">
        {ACTIVITIES.map(({ activity, icon }) => (
          <ActivityCard key={activity} copy={copy} activity={activity} icon={icon} hero_ids={hero_ids} />
        ))}
      </div>
    </section>
  )
}
