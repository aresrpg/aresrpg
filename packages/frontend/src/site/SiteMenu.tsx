// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The bar's menu on a narrow screen: the burger shows the bar's own navigation as a sheet that drops under the bar.
// The docs' rail is the same menu on their narrow screens.
import { useEffect, useId, useRef, useState, type FocusEvent, type KeyboardEvent, type MouseEvent } from 'react'

import type { AppCopy } from '../i18n/copy.ts'

/**
 * The menu's open state belongs to the shell's view. It is open on the page where it was opened, so a page change
 * closes it. Escape, a chosen entry and the scrim close it and give focus back to the burger.
 */
export const useSiteMenu = (pathname: string) => {
  const [opened_on, set_opened_on] = useState<string | null>(null)
  const open = opened_on === pathname
  const sheet_id = useId()
  const burger = useRef<HTMLButtonElement>(null)
  const sheet = useRef<HTMLElement>(null)
  const close = (restore_focus: boolean): void => {
    set_opened_on(null)
    if (restore_focus) burger.current?.focus({ preventScroll: true })
  }
  useEffect(() => {
    // Opening moves focus to the current page's entry; the page behind does not scroll meanwhile.
    if (open)
      (sheet.current?.querySelector<HTMLElement>('[aria-current="page"]') ?? sheet.current?.querySelector('a'))?.focus()
    document.documentElement.toggleAttribute('data-site-menu', open)
    return () => document.documentElement.removeAttribute('data-site-menu')
  }, [open])
  return {
    open,
    sheet_id,
    burger,
    sheet,
    close,
    toggle: (): void => (open ? close(true) : set_opened_on(pathname)),
    on_key_down: (event: Readonly<KeyboardEvent>): void => {
      if (open && event.key === 'Escape') close(true)
    },
    /** Focus that moves to something outside the bar closes the sheet and stays where it went. */
    on_blur: (event: Readonly<FocusEvent<HTMLElement>>): void => {
      if (open && event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget))
        close(false)
    },
    on_pick: (event: Readonly<MouseEvent>): void => {
      if (open && event.target instanceof Element && event.target.closest('a')) close(true)
    },
  }
}

export type SiteMenu = Readonly<ReturnType<typeof useSiteMenu>>

/** The burger: three lines that turn into a cross while the sheet is open. */
export const Burger = ({ copy, menu }: Readonly<{ copy: AppCopy | null; menu: SiteMenu }>) => (
  <button
    ref={menu.burger}
    className="site-burger"
    type="button"
    aria-expanded={menu.open}
    aria-controls={menu.sheet_id}
    aria-label={menu.open ? copy?.site.menu_close : copy?.site.menu_open}
    onClick={menu.toggle}
  >
    <span aria-hidden="true">
      <i />
      <i />
      <i />
    </span>
  </button>
)
