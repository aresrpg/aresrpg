// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { CarvedSymbol } from '@aresrpg/ui'
import type { AppCopy } from '../../i18n/copy.ts'
import type { Page } from '../../modules/navigation.ts'

type Label = { [K in keyof AppCopy]: AppCopy[K] extends string ? K : never }[keyof AppCopy]
/** The pages the game opens in a window. The world is the canvas itself; Settings draws its own frame. */
type WindowPage = Exclude<Page, 'world' | 'settings'>
export const HUD_PAGE_META: Readonly<
  Record<WindowPage, Readonly<{ label: Label; icon: CarvedSymbol; class_name: string }>>
> = {
  mastery: { label: 'mastery', icon: 'mastery', class_name: 'mastery-window' },
  kolizeum: { label: 'kolizeum', icon: 'kolizeum', class_name: 'arena-window' },
  admin: { label: 'admin', icon: 'admin', class_name: 'admin-window' },
}
