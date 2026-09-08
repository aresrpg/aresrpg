// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

/** A recoverable job failure still settles its exact worker request. Worker errors are terminal. */
export type WorkerReply<T> = Readonly<{ id: number; result: T }> | Readonly<{ id: number; error: string }>
