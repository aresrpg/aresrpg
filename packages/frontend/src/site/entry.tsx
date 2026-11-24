// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The site's entry. Nothing is awaited before the first render: the store and the connection start, the
// current page's code is requested, and the shell paints. The game is another document and is never loaded here.
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { is_gift_entry, saved_gift_route } from '../airdrop/gift_intent.ts'
import { is_docs_path } from '../docs/routes.ts'
import { SITE_MODULES } from '../site_modules.ts'
import { dispatch_app, start_app } from '../store.ts'
import { ExternalWalletHost } from '../wallet/ExternalWalletHost.tsx'
import '../tailwind.css'

import { SITE_ADDRESSES, SITE_PAGES, site_page_of } from './routes.ts'
import { SITE_PAGE_LOADERS, SiteShell } from './SiteShell.tsx'

const pathname = location.pathname.replace(/\/+$/, '')

/** Pages with a design and a runtime of their own. Each paints itself and never mounts the shell. */
const standalone = (): (() => Promise<void>) | null => {
  if (pathname === SITE_ADDRESSES.allocation)
    return async () => (await import('../allocation/entry.tsx')).boot_allocation()
  if (is_docs_path(pathname)) return async () => (await import('../docs/entry.tsx')).boot_docs()
  if (is_gift_entry(pathname, location.hash, saved_gift_route()))
    return async () => (await import('../airdrop/gift_entry.tsx')).boot_gift()
  return null
}

const start_site = (): void => {
  void SITE_PAGE_LOADERS[site_page_of(pathname).key]()
  start_app(SITE_MODULES, { seat: false })
  // The site's home has one address. Any address the site does not know is corrected to it.
  if (!SITE_PAGES.some(({ path }) => path === pathname))
    dispatch_app({ type: 'location/open', href: `${SITE_ADDRESSES.market}${location.search}`, replace: true })
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <ExternalWalletHost />
      <SiteShell />
    </StrictMode>
  )
}

const boot = (): void => {
  // The sign-in popup's callback page: its opener reads the result from the address, so nothing may touch it.
  if (pathname === '/enoki') return
  const own = standalone()
  if (own) void own()
  else start_site()
  // Reporting loads after the page has started; it never holds the first paint.
  void import('../telemetry.ts').then(({ start_telemetry }) => start_telemetry())
}
boot()
