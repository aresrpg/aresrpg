// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { CHARACTER_PRICE_MIST } from './character_price.ts'

/** Default gas ceiling; variable-cost batches opt into estimation. Unused MIST remains in the address. */
export const GAS_BUDGET_MIST = 50_000_000n
/** What a wallet must hold to create a hero: the price and the gas ceiling. The game and the bot both refuse below it. */
export const CHARACTER_FUNDING_MIST = CHARACTER_PRICE_MIST + GAS_BUDGET_MIST
