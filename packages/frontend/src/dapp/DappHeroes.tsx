// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { lazy, Suspense, useMemo, useState, type ReactNode } from 'react'
import { Button, CarvedIcon, GameWindow, Panel, SegmentedControl } from '@aresrpg/ui'
import type { CharacterRow } from '@aresrpg/protocol'

import type { DetailTab } from '../characters/character_navigation.ts'
import type { CharacterSession } from '../characters/character_session.ts'
import { ItemCraftSessionContext } from '../components/ItemCrafting.tsx'
import { CHARACTER_TABS } from '../game/hud/CharacterWindow.tsx'
import { copy_text, type AppCopy } from '../i18n/copy.ts'
import { dispatch_app, useAppStore } from '../store.ts'
import { toast } from '../toast.ts'

import { account_bag, hero_items } from './account.ts'
import { dapp_text } from './copy.ts'
import { DappHeroCard, HeroPortrait } from './DappHeroCard.tsx'
import { DappHeroPicker } from './DappHeroPicker.tsx'
import { hero_editable, hero_session, type HeroDirect } from './hero_session.ts'
import { selected_hero } from './state.ts'

// The doll, bag and sheet styles the game's character tabs are drawn with, as their game window loads them.
import '../components/character_surfaces.css'
import '../characters/characters.css'
import './dapp_heroes.css'

const EquipmentTab = lazy(() => import('../characters/EquipmentTab.tsx'))
const StatsTab = lazy(() => import('../characters/StatsTab.tsx'))
const SpellsTab = lazy(() => import('../characters/SpellsTab.tsx'))
const JobsTab = lazy(() => import('../characters/JobsTab.tsx'))

type Hero = Readonly<CharacterRow>
/** The tabs of the game's character window a hero of the bot account has: the bot forges no rune. */
export type HeroTab = Exclude<DetailTab, 'runeforge'>
const HERO_TABS = CHARACTER_TABS.flatMap((entry) => (entry.tab === 'runeforge' ? [] : [entry]))

const look_at = (hero_id: string): void => dispatch_app({ type: 'dapp/select_hero', hero_id })

/**
 * The adapter of the game's character and jobs tabs for one hero of the bot account. A change or a
 * craft is one direct request; while the hero cannot change, a gesture says why and sends nothing.
 */
export const useHeroSession = (
  copy: AppCopy,
  hero: Hero
): Readonly<{ session: CharacterSession; editable: boolean }> => {
  const account = useAppStore(({ session }) => session.agent_inventory)
  const editable = useAppStore(({ dapp }) => hero_editable(dapp, hero))
  return useMemo(() => {
    const bag = account_bag(account)
    const send = ({ action, payload }: HeroDirect): void =>
      dispatch_app({ type: 'dapp/hero_direct', id: crypto.randomUUID(), hero_id: hero.id, action, payload })
    const locked = dapp_text(copy, 'detail_locked')
    const refuse = (): void => toast.add(locked, 'info')
    // Until the bag is fully read nothing in it is known to be free of a listing or a trade.
    const items = bag ? hero_items(bag, hero.kiosk) : []
    const roster = { characters: account.characters, select: look_at }
    return { editable, session: hero_session({ hero, items, roster, editable, locked, send, refuse }) }
  }, [account, copy, editable, hero])
}

type Sheet = Readonly<{ copy: AppCopy; hero: Hero; session: CharacterSession; editable: boolean }>
/**
 * One tab of the game's character window, for this hero. The gear, the characteristics and the spells
 * are keyed by the hero: a change of hero drops what was staged for the previous one. The professions
 * stay mounted, so the profession in view follows the player to the better crafter.
 */
const HeroTabBody = ({ tab, copy, hero, session, editable }: Sheet & Readonly<{ tab: HeroTab }>) => {
  switch (tab) {
    case 'equipment':
      return (
        <EquipmentTab
          key={hero.id}
          character={hero}
          copy={copy}
          session={session}
          preview={() => <HeroPortrait hero={hero} />}
        />
      )
    case 'stats':
      // Without an adapter the game's tab finds no owned character and stays locked.
      return (
        <StatsTab key={hero.id} character={hero} copy={copy} raise_stats={editable ? session.raise_stats : undefined} />
      )
    case 'spells':
      return <SpellsTab key={hero.id} character={hero} copy={copy} session={session} />
    case 'jobs':
      return <JobsTab character={hero} copy={copy} session={session} />
  }
}

/** The points a hero has not spent yet: each count opens the tab that spends it. A hero without any shows nothing. */
const unspent_points = (copy: AppCopy, hero: Hero, on_tab: (tab: HeroTab) => void): ReactNode => {
  const points = [
    { tab: 'stats', label: copy.fight_hud.level_up_stat_points, left: hero.available_points },
    { tab: 'spells', label: copy.fight_hud.level_up_spell_points, left: hero.available_spell_points },
  ] as const
  const open = points.filter(({ left }) => left > 0)
  return open.length
    ? open.map(({ tab, label, left }) => (
        <Button key={tab} data-heroes-points={tab} onClick={() => on_tab(tab)}>
          {label}
          <strong>{left}</strong>
        </Button>
      ))
    : null
}

/**
 * The chosen hero: who it is, why it cannot change when it cannot, then ONE window of the game with
 * its gear, characteristics, spells and professions, one tab at a time. The tab bar, the window frame
 * and every tab are the game's own; the window only takes the class and the title of the tab it shows.
 */
export const DappHeroSheet = ({
  copy,
  hero,
  tab,
  on_tab,
}: Readonly<{ copy: AppCopy; hero: Hero; tab: HeroTab; on_tab: (tab: HeroTab) => void }>) => {
  const { session, editable } = useHeroSession(copy, hero)
  const text = copy_text(copy.characters_page)
  const options = HERO_TABS.map((entry) => ({ value: entry.tab, label: text(`tab_${entry.tab}`) }))
  const { icon, layout } = HERO_TABS.find((entry) => entry.tab === tab)!
  return (
    <>
      <DappHeroCard copy={copy} hero={hero} actions={unspent_points(copy, hero, on_tab)} />
      {!editable && (
        <p className="dapp-warning" role="status" data-heroes-locked="">
          {dapp_text(copy, 'detail_locked')}
        </p>
      )}
      <GameWindow
        className={`gw-tab game-character-window game-character-window--${tab} ${layout} dapp-heroes-window`}
        data-character-panel={tab}
        title={text(`tab_${tab}`)}
        icon={<CarvedIcon name={icon} />}
        close={null}
        close_label={dapp_text(copy, 'close')}
      >
        <SegmentedControl<HeroTab> label={hero.name} options={options} value={tab} on_change={on_tab} />
        <div className="game-character-body aui-workspace-main">
          <Suspense
            fallback={
              <p className="dapp-note" role="status">
                {dapp_text(copy, 'loading')}
              </p>
            }
          >
            <HeroTabBody tab={tab} copy={copy} hero={hero} session={session} editable={editable} />
          </Suspense>
        </div>
      </GameWindow>
    </>
  )
}

const CraftScope = ({ copy, hero, children }: Readonly<{ copy: AppCopy; hero: Hero; children: ReactNode }>) => {
  const { session } = useHeroSession(copy, hero)
  const craft = useMemo(
    () => ({ character: hero, inventory: session.inventory, craft: session.craft }),
    [hero, session]
  )
  return <ItemCraftSessionContext.Provider value={craft}>{children}</ItemCraftSessionContext.Provider>
}
/**
 * Every item surface of the dapp (the item sheet, the market) crafts as the chosen hero of the bot
 * account, through the same session as the Heroes tab: never against the signed-in player's own bag.
 */
export const DappCraftScope = ({ copy, children }: Readonly<{ copy: AppCopy; children: ReactNode }>) => {
  const hero = useAppStore(({ dapp, session }) => selected_hero(dapp, session.agent_inventory))
  return hero ? (
    <CraftScope copy={copy} hero={hero}>
      {children}
    </CraftScope>
  ) : (
    children
  )
}

/** An account without a hero: the way to the first one is on the Home tab. */
const NoHero = ({ copy }: Readonly<{ copy: AppCopy }>) => (
  <Panel className="dapp-heroes-empty" data-heroes-empty="">
    <h3>{dapp_text(copy, 'heroes_empty_title')}</h3>
    <p className="dapp-note">{dapp_text(copy, 'heroes_empty_body')}</p>
    <Button tone="primary" onClick={() => dispatch_app({ type: 'dapp/tab', tab: 'home' })}>
      {dapp_text(copy, 'heroes_empty_action')}
    </Button>
  </Panel>
)

/** The pick only chooses whom to look at: a hero in a fight, a dungeon or on an activity is a choice too. */
const any_hero = (): boolean => true
const select_hero = ([hero_id]: readonly string[]): void => {
  if (hero_id) dispatch_app({ type: 'dapp/select_hero', hero_id })
}

/** The Heroes tab: one hero at a time, in one window of the game's own equipment, characteristics, spells and jobs tabs. */
export const DappHeroes = ({ copy }: Readonly<{ copy: AppCopy }>) => {
  const heroes = useAppStore(({ session }) => session.agent_inventory.characters)
  const hero = useAppStore(({ dapp, session }) => selected_hero(dapp, session.agent_inventory))
  // Which tab shows is this view's own: it stays when the hero changes.
  const [tab, set_tab] = useState<HeroTab>('equipment')
  const title = dapp_text(copy, 'heroes_title')
  return (
    <section className="dapp-section dapp-heroes-tab" aria-label={title}>
      <h2>{title}</h2>
      <p className="dapp-note">{dapp_text(copy, 'heroes_intro')}</p>
      {hero ? (
        <>
          <DappHeroPicker
            copy={copy}
            label={title}
            heroes={heroes}
            selected={[hero.id]}
            busy_selectable={any_hero}
            on_change={select_hero}
          />
          <DappHeroSheet copy={copy} hero={hero} tab={tab} on_tab={set_tab} />
        </>
      ) : (
        <NoHero copy={copy} />
      )}
    </section>
  )
}
