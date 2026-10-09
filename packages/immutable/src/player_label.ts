// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

export const display_address = (address: string): string => `${address.slice(0, 6)}…${address.slice(-4)}`

/** A self-subname keeps its full identity in state; only the visible label is shortened. */
export const display_suins_name = (name: string): string => name.replace(/^([a-z0-9-]+)(?:\.\1\.sui|@\1)$/i, '@$1')
