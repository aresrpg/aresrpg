// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { lazy, Suspense, useMemo, type ReactNode } from 'react'
import { Button, CarvedIcon, GameWindow, Panel, type CarvedSymbol } from '@aresrpg/ui'
import type { CharacterRow } from '@aresrpg/protocol'

import type { CharacterSession } from '../characters/character_session.ts'
import { ItemCraftSessionContext } from '../components/ItemCrafting.tsx'
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

/** One character tab of the game inside the game's own window frame, laid in the page. `layout` is
 *  the game's own layout class of that tab, when it has one. */
const HeroWindow = ({
  copy,
  tab,
  icon,
  title,
  layout = '',
  children,
}: Readonly<{
  copy: AppCopy
  tab: 'equipment' | 'stats' | 'spells' | 'jobs'
  icon: CarvedSymbol
  title: string
  layout?: string
  children: ReactNode
}>) => (
  <GameWindow
    className={`gw-tab game-character-window game-character-window--${tab} ${layout} dapp-heroes-window`}
    data-character-panel={tab}
    title={title}
    icon={<CarvedIcon name={icon} />}
    close={null}
    close_label={dapp_text(copy, 'close')}
  >
    <div className="game-character-body aui-workspace-main">
      <Suspense
        fallback={
          <p className="dapp-note" role="status">
            {dapp_text(copy, 'loading')}
          </p>
        }
      >
        {children}
      </Suspense>
    </div>
  </GameWindow>
)

/** The chosen hero: who it is, why it cannot change when it cannot, then its gear, characteristics and spells. */
const HeroDetail = ({ copy, hero }: Readonly<{ copy: AppCopy; hero: Hero }>) => {
  const { session, editable } = useHeroSession(copy, hero)
  return (
    <>
      <DappHeroCard copy={copy} hero={hero} />
      {!editable && (
        <p className="dapp-warning" role="status" data-heroes-locked="">
          {dapp_text(copy, 'detail_locked')}
        </p>
      )}
      <HeroWindow copy={copy} tab="equipment" icon="inventory" title={dapp_text(copy, 'detail_equipment')}>
        <EquipmentTab character={hero} copy={copy} session={session} preview={() => <HeroPortrait hero={hero} />} />
      </HeroWindow>
      <HeroWindow copy={copy} tab="stats" icon="stats" title={dapp_text(copy, 'detail_stats')}>
        {/* Without an adapter the game's tab finds no owned character and stays locked. */}
        <StatsTab character={hero} copy={copy} raise_stats={editable ? session.raise_stats : undefined} />
      </HeroWindow>
      <HeroWindow copy={copy} tab="spells" icon="spells" title={dapp_text(copy, 'detail_spells')}>
        <SpellsTab character={hero} copy={copy} session={session} />
      </HeroWindow>
    </>
  )
}

/**
 * The hero's professions, through the game's own jobs tab: its levels, its recipes with what its bag
 * holds, the game's advice on what to craft and who crafts better, and a Craft the bot signs. It stays
 * mounted when the hero changes, so the profession in view follows the player to the better crafter.
 */
const HeroJobs = ({ copy, hero }: Readonly<{ copy: AppCopy; hero: Hero }>) => {
  const { session } = useHeroSession(copy, hero)
  return (
    <HeroWindow
      copy={copy}
      tab="jobs"
      icon="jobs"
      title={copy_text(copy.characters_page)('tab_jobs')}
      layout="aui-feature-port aui-jobs-port"
    >
      <JobsTab character={hero} copy={copy} session={session} />
    </HeroWindow>
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

/** The Heroes tab: one hero at a time, through the game's own equipment, characteristics, spells and jobs tabs. */
export const DappHeroes = ({ copy }: Readonly<{ copy: AppCopy }>) => {
  const heroes = useAppStore(({ session }) => session.agent_inventory.characters)
  const hero = useAppStore(({ dapp, session }) => selected_hero(dapp, session.agent_inventory))
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
          {/* A change of hero drops what was staged for the previous one. */}
          <HeroDetail key={hero.id} copy={copy} hero={hero} />
          <HeroJobs copy={copy} hero={hero} />
        </>
      ) : (
        <NoHero copy={copy} />
      )}
    </section>
  )
}
