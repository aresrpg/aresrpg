// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The site's addresses, in one place: its pages in the order of the bar, and where its other links lead.
// The game links here too, so this file imports no page code. The link-card painter reads the bar from here at
// request time too, so this file imports nothing but other address lists.
import { DOCS_ROOT } from '../docs/routes.ts'

/** The pages of the site, in the order of the bar. The first one is the site's home. */
export const SITE_PAGES = Object.freeze([
  { key: 'market', path: '/market' },
  { key: 'agent', path: '/agent' },
  { key: 'staking', path: '/staking' },
  { key: 'leaderboards', path: '/leaderboards' },
  { key: 'portfolio', path: '/portfolio' },
] as const satisfies readonly Readonly<{ key: string; path: string }>[])

export type SitePage = (typeof SITE_PAGES)[number]['key']

const path_of = (key: SitePage): string => SITE_PAGES.find((page) => page.key === key)!.path

/** The page an address shows. An address the site does not know shows its home. */
export const site_page_of = (pathname: string): (typeof SITE_PAGES)[number] =>
  SITE_PAGES.find(({ path }) => path === pathname) ?? SITE_PAGES[0]

/** The site's pages, the game, the docs and agent guides, then the places outside the site. */
export const SITE_ADDRESSES = Object.freeze({
  market: path_of('market'),
  agent: path_of('agent'),
  staking: path_of('staking'),
  leaderboards: path_of('leaderboards'),
  portfolio: path_of('portfolio'),
  /** The dashboard, shown to the admin address alone. It is no page of the bar's list: it has no link card. */
  admin: '/admin',
  /** The game is a document of its own; the site opens it in a new tab. */
  world: '/world',
  docs: DOCS_ROOT,
  items: `${DOCS_ROOT}/items`,
  playbook: '/agents',
  agent_guide: '/agents/client.txt',
  journal: 'https://journal.aresrpg.world',
  discord: 'https://discord.gg/aresrpg',
  telegram: 'https://t.me/aresrpg',
  x: 'https://x.com/AresRPG',
  source: 'https://github.com/aresrpg/aresrpg',
})

/**
 * Where KARES trades: Aftermath's swap page, opened with KARES as the coin to buy. The coin is named by
 * its full type, because other coins carry the same name, and paid in SUI, the pool's other coin, so the
 * swap is direct. Before the launch there is no type, and the
 * address is the plain swap page.
 */
export const kares_trade_href = (coin_type: unknown): string => {
  const swap = 'https://aftermath.finance/trade'
  return typeof coin_type === 'string' && coin_type ? `${swap}?from=SUI&to=${encodeURIComponent(coin_type)}` : swap
}

/** An item's own page on the market. */
export const market_item_href = (item_type: string): string =>
  `${SITE_ADDRESSES.market}?${new URLSearchParams({ item: item_type })}`

/** An item's page is an address of the market page, so it opens in a new tab and can be shared. */
export const market_item_of = (search: string): string | null => new URLSearchParams(search).get('item')

/** Whether a view keeps its lower left corner free of content: the market's home under its rail and the leaderboards
 *  under their index. On every other view the status card would cover content, so it floats as a chip. */
export const has_left_lane = ({ pathname, search }: Readonly<{ pathname: string; search: string }>): boolean => {
  const { key } = site_page_of(pathname)
  return key === 'leaderboards' || (key === 'market' && market_item_of(search) === null)
}

/** The sections of the staking page. The section is the page's hash, so a link can open any one. */
export const STAKING_SECTIONS = ['staking', 'tokenomics', 'mastery', 'airdrop'] as const
export type StakingSection = (typeof STAKING_SECTIONS)[number]
/** Staking is the page's first section. */
export const staking_section_of = (hash: string): StakingSection =>
  STAKING_SECTIONS.find((section) => hash === `#${section}`) ?? 'staking'
export const staking_section_href = (section: StakingSection): string => `${SITE_ADDRESSES.staking}#${section}`
/**
 * The staking sections that need the game account. Tokenomics reads public figures only, and the staking
 * desk also serves an external wallet, so a visitor may stake without a game account.
 */
const STAKING_ACCOUNT_SECTIONS: ReadonlySet<StakingSection> = new Set(['mastery', 'airdrop'])

/** Whether an address shows a view about the account: the portfolio, the AI page and the staking sections that sign. */
export const is_account_view = ({ pathname, hash }: Readonly<{ pathname: string; hash: string }>): boolean => {
  const { key } = site_page_of(pathname)
  if (key === 'staking') return STAKING_ACCOUNT_SECTIONS.has(staking_section_of(hash))
  return key === 'portfolio' || key === 'agent'
}
