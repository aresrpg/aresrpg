// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

export type WalletRecipientKind = 'address' | 'character' | 'suins'

export type WalletRecipient =
  Readonly<{ kind: 'idle' | 'invalid_address'; value: string }> | Readonly<{ kind: WalletRecipientKind; value: string }>

const SUI_ADDRESS = /^0x[0-9a-f]{64}$/i
const SUI_ADDRESS_PREFIX = /^0x/i
const SUINS_NAME =
  /^(?:@[a-z0-9][a-z0-9-]*|[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)*\.sui|[a-z0-9][a-z0-9-]*@[a-z0-9][a-z0-9-]*)$/i

export const classify_wallet_recipient = (input: string): WalletRecipient => {
  const value = input.trim()
  if (SUI_ADDRESS.test(value)) return Object.freeze({ kind: 'address', value })
  if (SUI_ADDRESS_PREFIX.test(value)) return Object.freeze({ kind: 'invalid_address', value })
  if (SUINS_NAME.test(value)) return Object.freeze({ kind: 'suins', value })
  if (value.length >= 4) return Object.freeze({ kind: 'character', value })
  return Object.freeze({ kind: 'idle', value })
}
