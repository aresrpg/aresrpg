// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Link behaviour shared by the engine-less pages (home, docs).
import type { MouseEvent, ReactNode } from 'react'

/** A plain left click. Modified clicks keep native browser behaviour (new tab, new window, download). */
export const is_plain_click = (event: Readonly<MouseEvent>): boolean =>
  event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey

/** Opens another site in a new tab and says so to assistive technology. */
export const ExternalLink = ({
  href,
  new_tab,
  className,
  children,
}: Readonly<{ href: string; new_tab: string; className?: string; children: ReactNode }>) => (
  <a className={className} href={href} rel="noopener noreferrer" target="_blank">
    {children}
    <span className="aui-sr">{new_tab}</span>
  </a>
)
