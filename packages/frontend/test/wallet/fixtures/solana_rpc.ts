// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { address } from '@solana/kit'

// Synthetic accounts and RPC results. No real wallet or signing key is used.
export const SOLANA_SENDER = address('9hSR6S7WPtxmTojgo6GG3k4yDPecgJY292j7xrsUGWBu')
export const SOLANA_RECIPIENT = address('GyGKxMyg1p9SsHfm15MkNUu1u9TN2JtTspcdmrtGUdse')
export const SOLANA_MINT = address('GgBaCs3NCBuZN12kCJgAW63ydqohFkHEdfdEXBPzLHq')
export const SOLANA_ACCOUNTS = [
  address('US517G5965aydkZ46HS38QLi7UQiSojurfbQfKCELFx'),
  address('YMN9Qj5jPNp7j14VPcML1B6xGgcPWVZUGLFU3Mnyfaf'),
] as const
export const solana_rpc_result = (method: string, balance = 10_000_000_000) => {
  const replies: Record<string, unknown> = {
    getBalance: { context: { slot: 1 }, value: balance },
    getLatestBlockhash: {
      context: { slot: 1 },
      value: { blockhash: 'QWmroo4YnnMqYW3cnxWkFdaTxGD3P7vMSzwMHGbUzwF', lastValidBlockHeight: 1000 },
    },
    getFeeForMessage: { context: { slot: 1 }, value: 5000 },
    getAccountInfo: { context: { slot: 1 }, value: null },
    getMinimumBalanceForRentExemption: 2_039_280,
    getTokenAccountsByOwner: {
      context: { slot: 1 },
      value: [400_000, 900_000].map((amount, index) => ({
        pubkey: SOLANA_ACCOUNTS[index],
        account: {
          executable: false,
          lamports: 2_039_280,
          rentEpoch: 0,
          space: 165,
          owner: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
          data: {
            program: 'spl-token',
            space: 165,
            parsed: {
              type: 'account',
              info: {
                mint: SOLANA_MINT,
                owner: SOLANA_SENDER,
                tokenAmount: { amount: String(amount), decimals: 6, uiAmount: amount / 1_000_000 },
              },
            },
          },
        },
      })),
    },
  }
  if (!(method in replies)) throw new Error(`Unexpected Solana RPC: ${method}`)
  return replies[method]
}
