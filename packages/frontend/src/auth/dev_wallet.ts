// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// DEV-ONLY native-wallet login. Provably ABSENT from production builds: this module is imported
// only via `await import('./dev_wallet')` inside an `if (import.meta.env.DEV)` branch in ./index,
// so rollup dead-code-eliminates the dynamic import (and this whole module + its crypto) when DEV
// is statically false. Lets Playwright / a local browser play the REAL rendered UI authenticated by
// a local Ed25519 keypair via the server's native-wallet auth, with NO Google/Enoki popup. The key
// is supplied out-of-band and NEVER committed or put in a URL:
//   - window.__ARES_DEV_KEY        (Playwright addInitScript)
//   - localStorage 'ares_dev_key'  (set via the Playwright MCP before navigating to ?dev)
//   - VITE_DEV_KEY env              (manual local use)
// It is a real keypair signing the real challenge — native auth, not a bypass. TESTNET ONLY: there
// is NO prod escape hatch (no VITE_OWNER_PLAY) — DEV is the only gate.

import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography'
import type { Transaction } from '@mysten/sui/transactions'
import type { ClientWithCoreApi } from '@mysten/sui/client'
import type { Wallet as WalletStandard } from '@mysten/wallet-standard'

import { get_sdk } from '../chain/sdk'
import { DEMO_NETWORK } from '../chain/deployment'

export const DEV_WALLET_NAME = 'AresRPG Dev Wallet'
const CHAIN = 'sui:testnet' // testnet only — never mainnet

// Dev-login is STICKY for the tab once established. The in-app router redirect (app `*` -> /game-world)
// AND the post-create-mint reload (CharacterMenu) both drop the `?dev` query, so gating purely on the
// URL would silently log the dev OUT on the first reload (the boot would fall through to the Google
// login). We persist a sessionStorage marker on the first `?dev` boot and honor it on later reloads.
// DEV builds ONLY -> this whole module (and the marker) is tree-shaken from production: no prod hatch.
const DEV_STICKY_KEY = 'ares_dev_session'

const dev_sticky = (): boolean => {
  try {
    return window.sessionStorage?.getItem(DEV_STICKY_KEY) === '1'
  } catch {
    return false
  }
}

/** Drop the sticky dev-login marker so a dev actually signs out (called from the logout paths). */
export const clear_dev_login = (): void => {
  try {
    window.sessionStorage?.removeItem(DEV_STICKY_KEY)
  } catch {
    /* sessionStorage unavailable — nothing to clear */
  }
}

/** A bech32 `suiprivkey1…` secret, or '' if none is available. */
const dev_secret = (): string => {
  if (typeof window === 'undefined') return ''
  const env = import.meta.env as unknown as Record<string, string | undefined>
  return (
    (window as unknown as { __ARES_DEV_KEY?: string }).__ARES_DEV_KEY ||
    window.localStorage?.getItem('ares_dev_key') ||
    env.VITE_DEV_KEY ||
    ''
  )
}

/**
 * Is a `?dev` native-wallet login requested (or sticky for this tab from an earlier `?dev` boot) AND a
 * key available? DEV builds ONLY (no prod hatch). The sticky marker is what carries the dev session
 * across the create->mint reload (which drops the `?dev` query) so the dev is never kicked to Google.
 */
export const is_dev_login = (): boolean => {
  if (!import.meta.env.DEV || typeof window === 'undefined') return false
  if (!dev_secret()) return false
  return new URLSearchParams(window.location.search).has('dev') || dev_sticky()
}

export interface DevSession {
  address: string
  wallet: WalletStandard
  account: { address: string; publicKey: Uint8Array; chains: string[]; features: string[] }
}

/**
 * Build a wallet-standard-shaped session backed by a local keypair — the SAME { address, wallet,
 * account } shape the auth sign_* helpers consume, so they sign the login challenge + the sponsored
 * sender-half natively. Mirrors the Enoki wallet's signPersonalMessage / signTransaction features.
 * The server builds + sponsors the PTB; we re-serialize (BCS is deterministic) and sign the sender.
 */
export const dev_session = (build_client: ClientWithCoreApi): DevSession => {
  // Establishing a dev session makes it sticky for the tab so it survives the create->mint reload
  // (and any other in-app reload) that drops the `?dev` query. Idempotent.
  try {
    window.sessionStorage?.setItem(DEV_STICKY_KEY, '1')
  } catch {
    /* sessionStorage unavailable — dev-login simply won't persist across reloads */
  }
  const keypair = Ed25519Keypair.fromSecretKey(decodeSuiPrivateKey(dev_secret()).secretKey)
  const address = keypair.getPublicKey().toSuiAddress()

  // L1 ANCHOR (docs/GOLD_STANDARD_SUITE.md §11) — on localnet the injected `build_client` is the testnet
  // GraphQL client (localnet has NO graphql), which cannot resolve localnet objects/gas at build time. Build
  // with the SDK's localnet gRPC client instead — the SAME client the execute path below already uses — so a
  // self-pay tx (create/equip/fight…) builds against the chain it will actually land on. testnet/mainnet keep
  // the passed `build_client` unchanged (byte-for-byte the prior behaviour). DEV-only module — absent from prod.
  const resolve_build_client = async (): Promise<ClientWithCoreApi> =>
    DEMO_NETWORK === 'localnet' ? ((await get_sdk()).grpc_client as unknown as ClientWithCoreApi) : build_client

  const account = {
    address,
    publicKey: keypair.getPublicKey().toRawBytes(),
    chains: [CHAIN],
    features: ['sui:signPersonalMessage', 'sui:signTransaction'],
  }

  const wallet = {
    name: DEV_WALLET_NAME,
    icon: '',
    version: '1.0.0',
    chains: [CHAIN],
    accounts: [account],
    features: {
      'sui:signPersonalMessage': {
        version: '1.0.0',
        signPersonalMessage: ({ message }: { message: Uint8Array }) => keypair.signPersonalMessage(message),
      },
      'sui:signTransaction': {
        version: '2.0.0',
        signTransaction: async ({ transaction }: { transaction: Transaction }) => {
          // Mirror the Enoki wallet (wallet.mjs sets `setSenderIfNotSet` before build): a CLIENT-built
          // self-pay tx carries no sender, so `build()` throws "Missing transaction sender" without this.
          // Sponsor bytes already carry the sender → this is a no-op there.
          transaction.setSenderIfNotSet(address)
          const bytes = await transaction.build({ client: await resolve_build_client() })
          return keypair.signTransaction(bytes)
        },
      },
      // The backend-off demo surface self-pays gameplay via `sui:signAndExecuteTransaction` (the Enoki
      // zkLogin wallet exposes it natively). The dev wallet only signs, so we build + sign + submit here
      // ourselves — letting the dev-login path (qa's local run + the CTO's E2E) exercise the real
      // self-pay loop without Enoki. DEV-only (this whole module is tree-shaken from prod).
      'sui:signAndExecuteTransaction': {
        version: '2.0.0',
        signAndExecuteTransaction: async ({ transaction }: { transaction: Transaction }) => {
          transaction.setSenderIfNotSet(address) // self-pay tx has no sender until set — mirror Enoki
          const bytes = await transaction.build({ client: await resolve_build_client() })
          const { signature } = await keypair.signTransaction(bytes)
          // #23/D79: gRPC Core API execute (SDK's shared client). Consumers of this feature read only `.digest`
          // (the same shape the Enoki wallet's signAndExecuteTransaction returns), so we surface the executed
          // digest; the full receipt is fetched separately via waitForTransaction by each caller.
          const { grpc_client } = await get_sdk()
          const res = await grpc_client.core.executeTransaction({
            transaction: bytes,
            signatures: [signature],
            include: { effects: true },
          })
          const executed = res.Transaction ?? res.FailedTransaction
          if (!(executed.effects?.status.success ?? false))
            throw new Error(executed.effects?.status.error?.message ?? `Transaction ${executed.digest} failed`)
          return { digest: executed.digest }
        },
      },
    },
  } as unknown as WalletStandard

  return { address, wallet, account }
}
