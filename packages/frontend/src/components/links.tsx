// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Link behaviour shared by the engine-less pages (the site's pages, the docs).
import type { MouseEvent, ReactNode } from 'react'

/** A plain left click. Modified clicks keep native browser behaviour (new tab, new window, download). */
export const is_plain_click = (event: Readonly<MouseEvent>): boolean =>
  event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey

/** A post on X with its text and, when the post shares a page, that page's address (X shows the page's card). */
export const x_post_url = (text: string, url?: string): string =>
  `https://x.com/intent/tweet?${new URLSearchParams(url ? { text, url } : { text })}`

/** Opens a link in a new tab and says so to assistive technology. */
export const NewTabLink = ({
  href,
  new_tab,
  className,
  children,
  on_click,
}: Readonly<{
  href: string
  new_tab: string
  className?: string
  children: ReactNode
  on_click?: (event: Readonly<MouseEvent<HTMLAnchorElement>>) => void
}>) => (
  <a className={className} href={href} rel="noopener noreferrer" target="_blank" onClick={on_click}>
    {children}
    <span className="aui-sr">{new_tab}</span>
  </a>
)
