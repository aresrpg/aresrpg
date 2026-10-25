// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { EngineIssue } from './types.ts'

const MISSING_ASSET = 'ares:missing-asset'
export const missing_asset_error = (message: string): Error => new Error(message, { cause: MISSING_ASSET })
export const is_missing_asset_error = (error: unknown): boolean =>
  error instanceof Error && (error.cause === MISSING_ASSET || is_missing_asset_error(error.cause))
export const terrain_failure = (error: unknown): EngineIssue => ({
  code: is_missing_asset_error(error) ? 'asset_missing' : 'terrain_failed',
  detail: error instanceof Error ? error.message : String(error),
})
