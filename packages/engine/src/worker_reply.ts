// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { is_missing_asset_error, missing_asset_error } from './asset_error.ts'

type WorkerError = Readonly<{ error: string; missing_asset?: true }>
export const worker_error = (error: unknown): WorkerError => ({
  error: error instanceof Error ? error.message : String(error),
  ...(is_missing_asset_error(error) ? { missing_asset: true as const } : {}),
})
export const read_worker_error = (reply: WorkerError): Error =>
  reply.missing_asset === true ? missing_asset_error(reply.error) : new Error(reply.error)

/** A recoverable job failure still settles its exact worker request. Worker errors are terminal. */
export type WorkerReply<T> = Readonly<{ id: number; result: T }> | (Readonly<{ id: number }> & WorkerError)
