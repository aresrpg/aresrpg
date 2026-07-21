// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// MISSING-ARTIFACT (#117): seed/mainnet/shop.json is content-pipeline output (the shop-seed generator SSOT),
// absent by design in this public repo. A bare readFileSync at module top level throws synchronously — this
// guards it ONCE so every consumer test file degrades to SHOP_AVAILABLE=false + an empty shop shape instead
// of crashing at import time, letting any content-independent test in the same file keep running for real.
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const SHOP_PATH = fileURLToPath(new URL('../../../../seed/mainnet/shop.json', import.meta.url))
export const SHOP_AVAILABLE = existsSync(SHOP_PATH)
export const shop = SHOP_AVAILABLE ? JSON.parse(readFileSync(SHOP_PATH, 'utf8')) : { cosmetics: [], pets: [] }
