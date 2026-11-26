// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Copy shape, in-page links and the object chips shared by every docs page.
import { createContext, useContext, type MouseEvent, type ReactNode } from 'react'

import { is_plain_click } from '../components/links.tsx'
import { item_icon, mob_icon } from '../content/assets.ts'
import type { SeedItem, SeedMob } from '../content/catalog.ts'

import { docs_path, type DocsGroup, type DocsGuide, type DocsMechanic } from './routes.ts'

type Step = Readonly<{ title: string; body: string }>

/** Every player-facing docs string. Reference views keep the encyclopedia's own copy. */
export type DocsCopy = Readonly<{
  title: string
  nav_label: string
  home: string
  play: string
  menu: string
  previous: string
  next: string
  search: string
  search_empty: string
  data_note: string
  kinds: Readonly<{ guide: string; item: string; mob: string }>
  groups: Readonly<Record<DocsGroup, string>>
  guides: Readonly<{
    overview: string
    ways: string
    first_hour: string
    bots: string
    market: string
    kares: string
    agents: string
    build: string
  }>
  overview: Readonly<{
    lede: string
    counts: Readonly<{ items: string; spells: string; mobs: string; recipes: string; classes: string; jobs: string }>
    protocol_title: string
    protocol: readonly string[]
    loop_title: string
    loop: readonly string[]
  }>
  ways: Readonly<{
    lede: string
    note: string
    specs: Readonly<{ runs_in: string; role: string; good_for: string; status: string }>
    /** Who makes the moves. */
    play: Readonly<{ manual: string; automated: string }>
    items: Readonly<
      Record<
        'world' | 'agent' | 'sdk',
        Readonly<{ name: string; body: string; runs_in: string; role: string; good_for: string; status: string }>
      >
    >
  }>
  bots: Readonly<{
    lede: string
    wallet_title: string
    wallet: readonly string[]
    does_title: string
    does: readonly string[]
    control_title: string
    control: readonly string[]
  }>
  first_hour: Readonly<{
    lede: string
    steps: readonly [Step, Step, Step, Step, Step]
    drop_chance: string
  }>
  market: Readonly<{
    lede: string
    royalty: string
    royalty_floor: string
    lot_sizes: string
    points: readonly [string, string, string]
  }>
  kares: Readonly<{
    lede: string
    note: string
    live_lede: string
    points: readonly [string, string, string, string, string]
  }>
  agents: Readonly<{
    lede: string
    steps: readonly [string, string, string]
    points: readonly [string, string, string]
    guide: string
    index: string
  }>
  build: Readonly<{
    lede: string
    source_title: string
    source_body: string
    playbook_title: string
    playbook_body: string
    blocks_title: string
    blocks: readonly [string, string, string, string]
    license_title: string
    allowed_title: string
    allowed: readonly [string, string]
    forbidden_title: string
    forbidden: readonly [string, string]
    license_note: string
    license_link: string
  }>
}>

const KEPT_UPPER = new Set(['XP', 'AP', 'MP', 'HP', 'PA', 'PM', 'PV'])
/**
 * The encyclopedia copy writes its headings in capitals for the game's small labels. A docs heading
 * is read as a sentence: the first letter stays, the rest goes lower case, short stat codes stay.
 */
export const sentence_case = (heading: string): string =>
  heading
    .split(' ')
    .map((word, index) => {
      if (KEPT_UPPER.has(word)) return word
      const lower = word.toLocaleLowerCase()
      return index === 0 ? lower.charAt(0).toLocaleUpperCase() + lower.slice(1) : lower
    })
    .join(' ')

/** Titles the docs copy owns. A mechanics page is titled by the encyclopedia copy, like its text. */
export const guide_title = (copy: DocsCopy, guide: Exclude<DocsGuide, DocsMechanic>): string =>
  copy.guides[guide === 'first-hour' ? 'first_hour' : guide]

const navigation = createContext<(pathname: string) => void>(() => undefined)
export const DocsNavigation = navigation.Provider

/** A real link that stays inside the page: modified clicks keep native browser behaviour. */
export const DocsLink = ({
  to,
  className,
  current,
  children,
}: Readonly<{ to: string; className?: string; current?: boolean; children: ReactNode }>) => {
  const navigate = useContext(navigation)
  const follow = (event: Readonly<MouseEvent<HTMLAnchorElement>>): void => {
    if (!is_plain_click(event)) return
    event.preventDefault()
    navigate(to)
  }
  return (
    <a aria-current={current ? 'page' : undefined} className={className} href={to} onClick={follow}>
      {children}
    </a>
  )
}

const ChipArt = ({ src }: Readonly<{ src: string | null }>) =>
  src ? <img alt="" src={src} /> : <span aria-hidden="true" className="docs-chip-blank" />

/** Every mention of a game object is a chip that opens its reference page. */
export const ItemChip = ({ item, quantity }: Readonly<{ item: SeedItem; quantity?: number }>) => (
  <DocsLink className="docs-chip" to={docs_path('items', item.item_type)}>
    <ChipArt src={item_icon(item.item_type)} />
    {quantity === undefined ? item.name : `${quantity} × ${item.name}`}
  </DocsLink>
)
export const MobChip = ({ mob }: Readonly<{ mob: SeedMob }>) => (
  <DocsLink className="docs-chip" to={docs_path('bestiary', mob.mob_type)}>
    <ChipArt src={mob_icon(mob.mob_type)} />
    {mob.name}
  </DocsLink>
)
