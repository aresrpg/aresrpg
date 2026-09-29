// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { createContext } from 'react'

/** Summaries show item identity and stats; acquisition and crafting belong to full item sheets. */
export const ItemDetailContext = createContext<'full' | 'summary'>('full')
