// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { ParsedDoor } from './generate_doors.mjs'

export const SEED_DOORS_OUT_PATH: string
export const SEED_CONTRACT_OUT_PATH: string
export const seed_doors: () => ParsedDoor[]
export const seed_string_keys: () => { name: string; module: string }[]
export const generate_seed_doors: () => Promise<string>
export const generate_seed_contract: () => Promise<string>
