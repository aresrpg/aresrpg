// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { createContext } from 'react'

/**
 * How much of an item a sheet shows. `summary`: identity and stats. `reference`: also where it comes from and its
 * recipe, as facts to read (the docs). `full`: the same with the actions of the game, crafting included.
 */
export const ItemDetailContext = createContext<'full' | 'reference' | 'summary'>('full')
