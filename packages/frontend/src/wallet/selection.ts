// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { WalletSelection } from './model.ts'

export type WalletStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

const address_patterns: Readonly<Record<string, RegExp>> = {
  sui: /^0x[0-9a-f]{1,64}$/i,
  evm: /^0x[0-9a-f]{40}$/i,
  solana: /^[1-9A-HJ-NP-Za-km-z]{32,44}$/,
}

const decode_selection = (value: unknown): WalletSelection | null => {
  if (typeof value !== 'object' || value === null) return null
  const { wallet_name, address, family } = value as Record<string, unknown>
  const pattern = address_patterns[String(family ?? 'sui')]
  if (typeof wallet_name !== 'string' || !wallet_name || typeof address !== 'string' || !pattern?.test(address))
    return null
  return { wallet_name, address, family: family as WalletSelection['family'] }
}

/** A public account selection, never credentials, signatures or transaction bytes. */
export const wallet_selection = (storage: WalletStorage | null, network: string) => {
  const key = `aresrpg:external-wallet:${network}`
  return {
    read: (): WalletSelection | null => {
      try {
        const raw = storage?.getItem(key)
        if (!raw) return null
        return decode_selection(JSON.parse(raw))
      } catch (error) {
        console.warn('Saved external wallet selection could not be read.', error)
        return null
      }
    },
    write: (selection: WalletSelection | null): void => {
      if (selection)
        storage?.setItem(
          key,
          JSON.stringify({ wallet_name: selection.wallet_name, address: selection.address, family: selection.family })
        )
      else storage?.removeItem(key)
    },
  }
}
