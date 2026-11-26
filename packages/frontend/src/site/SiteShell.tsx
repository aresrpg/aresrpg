// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The site's shell. It mounts once per visit: the bar, the page of the current address, the footer and the
// account's dialogs. A bar link swaps the page inside it; the connection and the sign-in survive every swap.
import { resolve_pins } from '@aresrpg/sdk/pins'
import { Ground } from '@aresrpg/ui'
import {
  ArrowUpRight,
  BookOpen,
  Briefcase,
  ChartNoAxesColumn,
  Check,
  Coins,
  Layers,
  Sparkles,
  Store,
  Swords,
  type LucideIcon,
} from 'lucide-react'
import { lazy, Suspense, useCallback, useState, type ComponentType, type MouseEvent, type ReactNode } from 'react'

import { LanguageCard } from '../components/AccountControls.tsx'
import { connection_label, indexing_health_tone, status_tone } from '../components/connection_status.ts'
import { is_plain_click, NewTabLink } from '../components/links.tsx'
import { Toasts } from '../components/Toasts.tsx'
import { env } from '../env.ts'
import type { AppCopy } from '../i18n/copy.ts'
import { LocaleScope } from '../i18n/LocaleScope.tsx'
import { signed_out } from '../modules/session.ts'
import { dispatch_app, useSiteStore } from '../store.ts'

import { has_left_lane, kares_trade_href, SITE_ADDRESSES, SITE_PAGES, site_page_of, type SitePage } from './routes.ts'
import { SignIn, useSignInStage } from './SignIn.tsx'
import { Burger, useSiteMenu, type SiteMenu } from './SiteMenu.tsx'
import './site_shell.css'

/** Each page's code loads apart. The entry starts the current page's load before the first render. */
export const SITE_PAGE_LOADERS: Readonly<
  Record<SitePage, () => Promise<{ default: ComponentType<{ copy: AppCopy }> }>>
> = {
  market: () => import('../marketplace/MarketPage.tsx'),
  agent: () => import('../agents/AgentPage.tsx'),
  staking: () => import('../kares/StakingPage.tsx'),
  leaderboards: () => import('../leaderboards/LeaderboardsPage.tsx'),
  portfolio: () => import('../portfolio/PortfolioPage.tsx'),
}
const PAGES: Readonly<Record<SitePage, ComponentType<{ copy: AppCopy }>>> = {
  market: lazy(SITE_PAGE_LOADERS.market),
  agent: lazy(SITE_PAGE_LOADERS.agent),
  staking: lazy(SITE_PAGE_LOADERS.staking),
  leaderboards: lazy(SITE_PAGE_LOADERS.leaderboards),
  portfolio: lazy(SITE_PAGE_LOADERS.portfolio),
}

// The account's surfaces load when an account exists or a dialog opens, never for a visitor who only reads.
const WalletCard = lazy(() => import('../components/WalletCard.tsx').then((module) => ({ default: module.WalletCard })))
const AccountDialogs = lazy(() => import('./AccountDialogs.tsx'))
const BlastSaleBar = lazy(() => import('../kares/BlastSaleBar.tsx'))

const open = (href: string) => (event: Readonly<MouseEvent>) => {
  if (!is_plain_click(event)) return
  event.preventDefault()
  dispatch_app({ type: 'location/open', href })
  globalThis.scrollTo(0, 0)
}

/** A link to an address of the site. A plain click swaps the page; a modified click keeps the browser's own. */
export const SiteLink = ({
  href,
  className,
  current,
  children,
}: Readonly<{ href: string; className?: string; current?: boolean; children: ReactNode }>) => (
  <a className={className} href={href} aria-current={current ? 'page' : undefined} onClick={open(href)}>
    {children}
  </a>
)

/**
 * The state of the two things every page reads through: the connection, and how far the indexer is behind the
 * chain. One small card with one mark that takes the worse of the two states. A wide window shows it in the dock above
 * the footer, as a chip that opens under the pointer or on focus where the view has no free corner for the card; a narrow one at the foot of the menu's sheet.
 */
const SiteStatus = ({ copy, dock = false }: Readonly<{ copy: AppCopy; dock?: boolean }>) => {
  const chip = useSiteStore(({ location }) => dock && !has_left_lane(location))
  const link_status = useSiteStore(({ session }) => session.link_status)
  const link_error = useSiteStore(({ session }) => session.link_error)
  const link_violation = useSiteStore(({ session }) => session.link_violation)
  const latency = useSiteStore(({ session }) => session.latency_ms)
  const lag = useSiteStore(({ session }) => session.indexing_lag)
  const sockets = useSiteStore(({ session }) => session.online_sockets)
  const health = {
    unknown: '—',
    healthy: copy.site.indexing_healthy,
    catching_up: copy.site.indexing_catching_up,
    lagging: copy.site.indexing_lagging,
  }[indexing_health_tone(lag)]
  const tone = status_tone({ link_status, link_error, link_violation, indexing_lag: lag })
  return (
    <aside
      className="site-status"
      data-tone={tone}
      data-chip={chip ? '' : undefined}
      tabIndex={chip ? 0 : undefined}
      aria-label={copy.indexing_health}
    >
      <p role="status">
        <span aria-hidden="true" />
        <b>{connection_label(copy, { link_status, link_error, link_violation })}</b>
        <output>{latency === null ? '' : `${latency} ${copy.latency_unit}`}</output>
      </p>
      <dl>
        {/* Everyone connected right now, signed in or not. */}
        <dt>{copy.online}</dt>
        <dd>{sockets ?? '—'}</dd>
        <dt>{copy.indexing_health}</dt>
        <dd>{health}</dd>
        <dt>{copy.indexing_block_remaining}</dt>
        <dd>{lag ?? '—'}</dd>
      </dl>
    </aside>
  )
}

/** A page's mark in the narrow menu. The wide bar shows the names only. */
const PAGE_ICONS: Readonly<Record<SitePage, LucideIcon>> = {
  market: Store,
  agent: Sparkles,
  staking: Layers,
  leaderboards: ChartNoAxesColumn,
  portfolio: Briefcase,
}

/**
 * The bar's links. Before the copy has loaded, each label holds its place. On a narrow screen the same navigation is
 * the menu's sheet, with the status card at its foot.
 */
const SiteNav = ({ copy, page, menu }: Readonly<{ copy: AppCopy | null; page: SitePage; menu: SiteMenu }>) => {
  const label = (key: SitePage | 'play'): ReactNode => copy?.site[key] ?? <span className="aui-skeleton site-stub" />
  const [home, ...others] = SITE_PAGES
  const link = ({ key, path }: (typeof SITE_PAGES)[number]): ReactNode => {
    const Icon = PAGE_ICONS[key]
    return (
      <SiteLink key={key} href={path} current={key === page}>
        <Icon className="site-nav-icon" size={19} strokeWidth={1.8} aria-hidden="true" />
        <span onPointerEnter={() => void SITE_PAGE_LOADERS[key]()}>{label(key)}</span>
        <Check className="site-nav-check" size={16} aria-hidden="true" />
      </SiteLink>
    )
  }
  return (
    <nav
      className="site-nav"
      id={menu.sheet_id}
      ref={menu.sheet}
      aria-label={copy?.site.nav_label}
      onClick={menu.on_pick}
    >
      {link(home)}
      <PlayKey copy={copy} label={label('play')} />
      {others.map(link)}
      {copy && <SiteStatus copy={copy} />}
    </nav>
  )
}

/** A key that refuses a click says why under itself, then forgets: each refusal replays the hint. */
const useRefusal = (refuses: boolean) => {
  const [refusal, set_refusal] = useState(0)
  const refuse = (event: Readonly<MouseEvent<HTMLAnchorElement>>): void => {
    if (!refuses) return
    event.preventDefault()
    event.stopPropagation()
    set_refusal((count) => count + 1)
  }
  const hint = (words: string | undefined) =>
    refusal > 0 && (
      <span className="site-refusal-hint" key={`hint-${refusal}`} role="status" onAnimationEnd={() => set_refusal(0)}>
        {words}
      </span>
    )
  return { refusal, refuse, hint }
}

/**
 * Play opens the game in a tab of its own: the game takes the account's one seat, so this page keeps its connection.
 * The game has no sign-in, so a visitor known to be signed out stays here and the key says to log in first.
 */
const PlayKey = ({ copy, label }: Readonly<{ copy: AppCopy | null; label: ReactNode }>) => {
  const { refusal, refuse, hint } = useRefusal(useSiteStore(({ session }) => signed_out(session)))
  return (
    <NewTabLink className="site-play" href={SITE_ADDRESSES.world} new_tab={copy?.site.new_tab ?? ''} on_click={refuse}>
      {/* The key remounts on each refusal, so its nudge and the hint replay. */}
      <span className="site-play-key" key={refusal} data-refused={refusal ? '' : undefined}>
        <Swords size={18} strokeWidth={1.8} aria-hidden="true" />
        {label}
      </span>
      <ArrowUpRight className="site-play-ext" size={14} aria-hidden="true" />
      {hint(copy?.site.log_in_first)}
    </NewTabLink>
  )
}

const Account = ({ copy, page }: Readonly<{ copy: AppCopy | null; page: SitePage }>) => {
  const session = useSiteStore((state) => state.session)
  // A view about the account holds the sign-in in its page, so the bar shows none there.
  const staged = useSignInStage()
  if (staged) return null
  if (!session.wallet || !copy) return <SignIn copy={copy} />
  // The portfolio lays this same card in its page, so its bar does not show it a second time.
  if (page === 'portfolio') return null
  return (
    <Suspense fallback={<span className="aui-skeleton site-account-stub" />}>
      <WalletCard
        key={session.wallet.address}
        compact
        copy={copy}
        session={session}
        disconnect={() => dispatch_app({ type: 'auth/disconnected' })}
      />
    </Suspense>
  )
}

/** The docs, one tap from every page: a quiet mark beside the language. */
const DocsMark = ({ copy }: Readonly<{ copy: AppCopy | null }>) => (
  <a
    className="aui-button aui-icon-button site-docs"
    href={SITE_ADDRESSES.docs}
    aria-label={copy?.site.docs}
    title={copy?.site.docs}
  >
    <BookOpen size={17} strokeWidth={1.8} aria-hidden="true" />
  </a>
)

/** Whether KARES trades yet: its coin type is pinned once the token is launched. */
const KARES_TRADES = Boolean(resolve_pins(env.network).kares_coin_type)

/**
 * KARES trades on Aftermath: one small gold key outside the bar, at its right, on wide windows. Until the token is
 * launched there is nothing to buy, so the key stays here and says so.
 */
const BuyKares = ({ copy }: Readonly<{ copy: AppCopy | null }>) => {
  const { refusal, refuse, hint } = useRefusal(!KARES_TRADES)
  return (
    <NewTabLink
      className={`site-buy-kares ${refusal ? 'site-buy-kares--refused' : ''}`}
      href={kares_trade_href(resolve_pins(env.network).kares_coin_type)}
      new_tab={copy?.site.new_tab ?? ''}
      on_click={refuse}
    >
      <Coins size={15} strokeWidth={1.8} aria-hidden="true" />
      {copy?.site.buy_kares ?? <span className="aui-skeleton site-stub" />}
      {hint(copy?.site.not_ready_yet)}
    </NewTabLink>
  )
}

const SALE_LINE_KEY = 'aresrpg:sale-line'

/**
 * The sale line's row, above the bar. The row is held from the first paint, so the page does not move when the
 * sale's state arrives; a browser that last saw no sale starts without it.
 */
const SaleLine = ({ copy }: Readonly<{ copy: AppCopy | null }>) => {
  const [held, hold] = useState(() => globalThis.localStorage?.getItem(SALE_LINE_KEY) !== 'off')
  const settle = useCallback((live: boolean): void => {
    globalThis.localStorage?.setItem(SALE_LINE_KEY, live ? 'on' : 'off')
    hold(live)
  }, [])
  return (
    <div className="site-sale" data-held={held ? '' : undefined}>
      {copy && (
        <Suspense fallback={null}>
          <BlastSaleBar copy={copy} settle={settle} />
        </Suspense>
      )}
    </div>
  )
}

const SiteFooter = ({ copy: { site } }: Readonly<{ copy: AppCopy }>) => (
  <footer className="site-footer">
    <div className="site-footer-brand">
      <span className="site-brand">AresRPG</span>
      <small>© {new Date().getFullYear()} AresRPG</small>
    </div>
    <nav aria-label={site.footer_learn}>
      <h2>{site.footer_learn}</h2>
      <a href={SITE_ADDRESSES.docs}>{site.docs}</a>
      <a href={SITE_ADDRESSES.items}>{site.encyclopedia}</a>
      <NewTabLink href={SITE_ADDRESSES.journal} new_tab={site.new_tab}>
        {site.journal}
      </NewTabLink>
    </nav>
    <nav aria-label={site.footer_community}>
      <h2>{site.footer_community}</h2>
      {(['discord', 'telegram', 'x'] as const).map((key) => (
        <NewTabLink key={key} href={SITE_ADDRESSES[key]} new_tab={site.new_tab}>
          {site[key]}
        </NewTabLink>
      ))}
    </nav>
  </footer>
)

export const SiteShell = () => {
  const copy = useSiteStore((state) => state.copy)
  const locale = useSiteStore((state) => state.locale)
  const pathname = useSiteStore((state) => state.location.pathname)
  const { key } = site_page_of(pathname)
  const Page = PAGES[key]
  const menu = useSiteMenu(pathname)
  return (
    <LocaleScope locale={locale}>
      <div className="site">
        <Ground />
        <SaleLine copy={copy} />
        <header
          className="site-bar"
          data-menu-open={menu.open ? '' : undefined}
          onKeyDown={menu.on_key_down}
          onBlur={menu.on_blur}
        >
          <SiteLink className="site-home" href={SITE_ADDRESSES.market}>
            {/* The helmet rises out of the bar: the bar's lower edge crops it and its crest passes over the upper one. */}
            <span className="site-helmet">
              <img src="/logo-192.png" alt="" width={84} height={84} />
            </span>
            <span className="site-brand">AresRPG</span>
          </SiteLink>
          <SiteNav copy={copy} page={key} menu={menu} />
          <DocsMark copy={copy} />
          {copy && (
            <LanguageCard
              compact
              copy={copy}
              locale={locale}
              change_locale={(next) => dispatch_app({ type: 'locale/changed', locale: next })}
            />
          )}
          <BuyKares copy={copy} />
          <Account copy={copy} page={key} />
          <Burger copy={copy} menu={menu} />
        </header>
        <div
          className="site-scrim"
          data-open={menu.open ? '' : undefined}
          aria-hidden="true"
          onClick={() => menu.close(true)}
        />
        <main className="site-main">
          <Suspense fallback={null}>{copy && <Page copy={copy} />}</Suspense>
        </main>
        {/* The status card's dock: a row as tall as the card, just above the footer. While the footer is below the
            window the row sticks to the window's bottom; when the footer arrives, the card lands in its first column. */}
        <div className="pointer-events-none sticky bottom-[calc(16px+var(--safe-bottom))] z-6 mx-auto mt-24 box-border h-(--site-status-h) w-[min(var(--site-page-width),100%)] px-(--site-gutter) *:pointer-events-auto max-[1079px]:hidden flex items-end">
          {copy && <SiteStatus copy={copy} dock />}
        </div>
        {copy && <SiteFooter copy={copy} />}
        {copy && (
          <Suspense fallback={null}>
            <AccountDialogs copy={copy} />
          </Suspense>
        )}
        <Toasts />
      </div>
    </LocaleScope>
  )
}
