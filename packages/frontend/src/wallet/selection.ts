// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { WalletSelection } from './model.ts'

export type WalletStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

/** A public account selection, never credentials, signatures or transaction bytes. */
export const wallet_selection = (storage: WalletStorage | null, network: string) => {
  const key = `aresrpg:external-wallet:${network}`
  return {
    read: (): WalletSelection | null => {
      try {
        const raw = storage?.getItem(key)
        if (!raw) return null
        const value: unknown = JSON.parse(raw)
        if (typeof value !== 'object' || value === null) return null
        const { wallet_name, address } = value as Record<string, unknown>
        return typeof wallet_name === 'string' &&
          wallet_name.length > 0 &&
          typeof address === 'string' &&
          /^0x[0-9a-f]{1,64}$/i.test(address)
          ? { wallet_name, address }
          : null
      } catch (error) {
        console.warn('Saved external wallet selection could not be read.', error)
        return null
      }
    },
    write: (selection: WalletSelection | null): void => {
      if (selection)
        storage?.setItem(key, JSON.stringify({ wallet_name: selection.wallet_name, address: selection.address }))
      else storage?.removeItem(key)
    },
  }
}
