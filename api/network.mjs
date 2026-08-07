// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The sponsor API's one network parser. Every module in this deployable imports this value (or calls the
// injectable parser in tests) instead of independently defaulting VITE_NETWORK.
export const network_from_env = (env = process.env) => (env.VITE_NETWORK || 'testnet').trim()

export const SPONSOR_NETWORK = network_from_env()
