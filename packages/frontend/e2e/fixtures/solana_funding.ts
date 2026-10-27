// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { BaseConnectedSolanaWallet } from '@privy-io/react-auth'

import { privy_wallet_choice } from '../../src/wallet/privy_adapter.ts'
import {
  SOLANA_SENDER as sender,
  SOLANA_RECIPIENT as recipient,
  SOLANA_MINT,
} from '../../test/wallet/fixtures/solana_rpc.ts'

const token = new URLSearchParams(location.search).has('token')
const asset = {
  asset_id: token ? 'usdc' : 'sol',
  blockchain: 'sol',
  symbol: token ? 'USDC' : 'SOL',
  decimals: token ? 6 : 9,
  price: 1,
  ...(token ? { contract: SOLANA_MINT } : {}),
}
const wallet = {
  type: 'solana',
  address: sender,
  meta: { name: 'Fixture Solana' },
  isConnected: async () => true,
  disconnect: () => {},
  provider: {
    signAndSendTransaction: async ({ transaction }: { transaction: Uint8Array }) => {
      document.documentElement.dataset.transaction = JSON.stringify(Array.from(transaction))
      return { signature: new Uint8Array(64).fill(5) }
    },
  },
} as unknown as BaseConnectedSolanaWallet

document.getElementById('connect')!.addEventListener('click', () => {
  void privy_wallet_choice(wallet)
    .connect(sender)
    .then(async (session) => {
      document.documentElement.dataset.balance = String(await session.balance(asset))
      await session.send({ asset, recipient, amount: token ? 1_000_000n : 123456n }, () => {})
      document.getElementById('result')!.textContent = 'Sent'
    })
    .catch((error: unknown) => {
      document.getElementById('result')!.textContent = error instanceof Error ? error.message : String(error)
    })
})
