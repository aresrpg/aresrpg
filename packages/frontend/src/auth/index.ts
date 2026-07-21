// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { create } from 'zustand'
import { getWallets, isWalletWithRequiredFeatureSet } from '@mysten/wallet-standard'
import { EnokiClient, registerEnokiWallets } from '@mysten/enoki'
import { SuiGraphQLClient } from '@mysten/sui/graphql'
import { Transaction } from '@mysten/sui/transactions'
import type { Wallet as WalletStandard, WalletAccount } from '@mysten/wallet-standard'

import { SPONSOR_URL } from '../env'
import i18n from '../i18n'
import { execute_tx, execute_sponsored_tx, type GasPin } from '../tx'
import { set_report_user } from '../core/report.js'
import { game_log } from '../core/log.js'

import { derive_zklogin_seed } from './zklogin_seed'
import { read_sui_balance_mist, with_post_tx_refresh, settle_balance_after_tx } from './sui_balance'
import { is_zklogin_wallet } from './zklogin_wallet'

// Post-tx balance invalidation (trigger b): every executed tx moved gas, so refresh the shared
// wallet balance the moment a door RESOLVES. Called via with_post_tx_refresh so a pre-sign dry-run refusal
// (which rejects, no gas moved) never triggers a needless read. SETTLE: the fullnode's balance
// index lags execution, so a single read can paint the PRE-tx figure (the live Send-SUI staleness) — re-drive
// the single-writer refresh until the value changes (settle_balance_after_tx early-stops on the first fresh read).
const refresh_balance_after_tx = () =>
  void settle_balance_after_tx(
    () => use_auth.getState().sui_balance_mist,
    () => use_auth.getState().refresh_sui_balance()
  )

export const ENOKI_API_KEY = 'enoki_public_ff89078fe8efa82d3f14732264813b91'
export const GOOGLE_CLIENT_ID = '263863163058-qn6qhkjmdvmlj8f1n4r0kdi4e608usbo.apps.googleusercontent.com'

// TESTNET ONLY (game hard law) — never mainnet. The shared Enoki/Google key works for testnet zkLogin (it is
// the same key already proven on testnet).
export const SUI_NETWORK = 'testnet' as const
export const SUI_CHAIN = 'sui:testnet' as const

// #23/D79 — the GraphQL client used for (1) the Enoki wallet registration (it accepts a `clients:
// ClientWithCoreApi[]` array, which a GraphQL client satisfies — never a gRPC one) and (2) building the
// kind-only sponsored PTB below (`Transaction.build({ client })` takes any Core-API client). Same testnet URL
// as the SDK's shared graphql_client (@mysten/sui docs). Reads/executes route through the SDK's gRPC client
// (get_sdk) — this client exists only for the two module-load-synchronous Enoki/build needs.
const graphql_client = new SuiGraphQLClient({
  url: 'https://graphql.testnet.sui.io/graphql',
  network: SUI_NETWORK,
})

// #23/D79: the JSON-RPC `sui_client` was DELETED with the W4 corpse (ws/index.ts). Its only consumer was that
// dead store's shop gas dry-run; every live auth read/write routes through the SDK's gRPC/GraphQL clients now,
// so no JSON-RPC surface remains here (the no-jsonrpc gate is absolute).

registerEnokiWallets({
  apiKey: ENOKI_API_KEY,
  providers: {
    google: {
      clientId: GOOGLE_CLIENT_ID,
      redirectUrl: typeof window !== 'undefined' ? `${window.location.origin}/enoki` : '',
    },
  },
  clients: [graphql_client],
  getCurrentNetwork: () => SUI_NETWORK,
})

const is_sui_wallet = (wallet: WalletStandard): boolean =>
  isWalletWithRequiredFeatureSet(wallet, ['sui:signPersonalMessage', 'sui:signTransaction'])

// DEV-only native-wallet (Ed25519), installed at boot when `?dev` + a dev key is present. In a
// production build `import.meta.env.DEV` is statically false, so the dev_wallet module is never
// imported and this stays null → the entire bypass is dead-code-eliminated (no prod escape hatch).
let dev_wallet: WalletStandard | null = null

export function find_wallet(name: string): WalletStandard | null {
  if (dev_wallet && name === dev_wallet.name) return dev_wallet
  return (
    getWallets()
      .get()
      .filter(is_sui_wallet)
      .find((w) => w.name === name) ?? null
  )
}

// MONEY LAW helper: is the CURRENT session a sponsorable zkLogin identity? A connected wallet-standard
// session is not — it self-pays every transaction — so callers (world_join) route it away from the sponsor.
export function is_zklogin_session(): boolean {
  const { wallet_name } = use_auth.getState()
  if (!wallet_name) return false
  const wallet = find_wallet(wallet_name)
  return wallet != null && is_zklogin_wallet(wallet)
}

async function connect_wallet(name: string): Promise<{ address: string; wallet_name: string } | null> {
  const wallet = find_wallet(name)
  if (!wallet) return null

  try {
    const feature = wallet.features['standard:connect'] as {
      connect: () => Promise<{ accounts: { address: string }[] }>
    }
    const result = await feature.connect()
    const [account] = result.accounts
    if (!account) return null
    return { address: account.address, wallet_name: wallet.name }
  } catch {
    return null
  }
}

async function disconnect_wallet(wallet_name: string | null): Promise<void> {
  if (!wallet_name) return
  const wallet = find_wallet(wallet_name)
  if (!wallet) return
  const feature = wallet.features['standard:disconnect'] as { disconnect: () => Promise<void> } | undefined
  if (feature) await feature.disconnect().catch((err) => game_log('auth', 'Wallet disconnect failed:', err))
}

// ── TX EXECUTION (S-54) — every self-pay + sponsored write delegates to the tx choke module (src/tx), which
// dry-runs EVERY tx BEFORE signing (refuse-on-fail = zero gas), pins budget = sim ×1.5, and refuses over the
// 0.1 SUI ceiling. These wrappers only resolve the wallet + inject the chain / build-client / sponsor url so
// the choke stays auth-free (side-effect-free, unit-testable). NAMES + SIGNATURES are the stable public
// surface dozens of callers import — do not change them.

// Sign AND execute in one wallet call (the wallet handles RPC submission). Preferred for Enoki/zkLogin wallets
// where the signing flow is special. Simulate-guarded in src/tx before the wallet ever signs (zero-gas refusal).
// `want_effects` (the fight commit choke's <1s lane) opts into the EXECUTE-CERT fast path: the receipt then
// carries `effects_result` (the RAW certified gRPC result) so the caller skips its waitForTransaction read leg.
// ADDITIVE param — every existing call site is untouched (signature-stability law above).
export async function sign_and_execute_transaction(
  wallet_name: string,
  address: string,
  transaction: Transaction,
  gas_pin?: GasPin,
  want_effects?: boolean
): Promise<{ digest: string; effects?: string; effects_result?: any }> {
  const wallet = find_wallet(wallet_name)
  if (!wallet) throw new Error('No wallet connected')
  return with_post_tx_refresh(
    // Event-refreshed balance + successful-read time: a <=30s high read may skip the sponsor round trip;
    // unknown/stale zkLogin balances go sponsor-first so the server remains authoritative.
    () =>
      execute_tx({
        wallet,
        address,
        transaction,
        chain: SUI_CHAIN,
        gas_pin,
        cached_balance_mist: use_auth.getState().sui_balance_mist,
        cached_balance_read_at_ms: use_auth.getState().sui_balance_read_at_ms,
        want_effects,
      }),
    refresh_balance_after_tx
  )
}

// Money PTBs split price/royalty from `tx.gas`, so sponsor gas must never fund them. This keeps the ordinary
// S-54 simulation and dryRun ×1.5 budget pin while closing both sponsor-first and gas-selection fallback routes.
export async function sign_and_execute_self_pay_transaction(
  wallet_name: string,
  address: string,
  transaction: Transaction
): Promise<{ digest: string; effects?: string; effects_result?: any }> {
  const wallet = find_wallet(wallet_name)
  if (!wallet) throw new Error('No wallet connected')
  return with_post_tx_refresh(
    () => execute_tx({ wallet, address, transaction, chain: SUI_CHAIN, sponsor_excluded: true }),
    refresh_balance_after_tx
  )
}

// TERMINAL `&Random` SUBMIT (S-19a) — sign + execute a tx whose LAST command consumes `&Random` (shop
// `buy`/`buy_many`, gather/search, forgemagie crush, loot-box open, gift send). S-54: the tx SHAPE dry-runs like
// any other (ratified 07-09: Sui dryRun CAN simulate &Random txs; only a randomness-VALUE-dependent abort is
// unknowable, and a well-formed one never aborts on the value) — so it routes through the SAME simulate-refuse
// gate. The SDK builder PINS the gas budget from a MEASURED constant × 1.5; `keep_budget` keeps that pinned
// budget as the MAX bound (the gate refuses a would-fail tx but leaves the budget untouched).
// SPONSOR ROUTING: `sponsor_excluded` (default false) is the SOLE self-pay gate — set it ONLY for a MONEY-split
// PTB (`buy`/`gift` split the PRICE/royalty off `tx.gas`; a sponsored gas coin would pay it — a drain). A
// NON-money &Random tx (search/gather/crush/open) leaves it false and is sponsor-first for a ≤0.2 SUI zkLogin
// wallet (the whole game is playable at zero SUI; the ≤0.4-SUI-pinned search stops demanding free balance).
// TX-RETRY law: the caller NEVER auto-retries an executed failure. PERF (2026-07-14, fixes slow buy-transaction latency):
// `want_effects: true` keeps the EXECUTE-CERT fast path (measured 07-12) — a sign-only submit returns the
// CERTIFIED effects in the execute round-trip itself, so world-shell/tx.js's run() skips its separate ~570ms
// waitForTransaction read leg whenever the fast path applies (sponsor-first / gas-station fallback / a wallet
// without sign-only fall back to that wait, on the FINALITY_POLL_SCHEDULE diet). Additive param only.
export async function submit_terminal_random_tx(
  wallet_name: string,
  address: string,
  transaction: Transaction,
  { sponsor_excluded = false }: { sponsor_excluded?: boolean } = {}
): Promise<{ digest: string; effects_result?: any }> {
  const wallet = find_wallet(wallet_name)
  if (!wallet) throw new Error('No wallet connected')
  return with_post_tx_refresh(
    () =>
      execute_tx({
        wallet,
        address,
        transaction,
        chain: SUI_CHAIN,
        keep_budget: true,
        sponsor_excluded,
        want_effects: true,
      }),
    refresh_balance_after_tx
  )
}

// SPONSORED execution for @server-gated PTBs (two-call station contract — docs/SPONSOR_TWO_CALL_CONTRACT.md). The
// client builds a KIND-ONLY PTB; the @server sponsor (fronting the Mysten gas STATION) prices + reserves gas, the
// client applies the reserved gas + signs the SENDER half, and the STATION co-signs the gas half + SUBMITS +
// returns the certified effects — the client NEVER submits a sponsored tx. Used for create-character AND
// join-world; gameplay stays self-pay. S-54: the tx choke dry-runs the gas-pinned tx BEFORE signing/executing, so
// a would-fail tx (e.g. a taken name) refuses with ZERO sponsor gas burned. The receipt shape is kept
// BYTE-EQUIVALENT on the two fields the consumers read (roster/store.ts, world_join.js): `res.digest` and
// `res.effects.status.{status,error}`.
export async function sponsor_and_execute_transaction(
  wallet_name: string,
  address: string,
  tx: Transaction
): Promise<{ digest: string; effects: { status: { status: 'success' | 'failure'; error?: string } } }> {
  const wallet = find_wallet(wallet_name)
  if (!wallet) throw new Error('No wallet connected')
  return with_post_tx_refresh(
    () => execute_sponsored_tx({ wallet, address, transaction: tx, chain: SUI_CHAIN, sponsor_url: SPONSOR_URL }),
    refresh_balance_after_tx
  )
}

// The zkLogin `address_seed` (u256 as a decimal string) required by the FREE first-character mint gate
// (`creation::create_character_free`'s on-chain `check_zklogin_issuer(sender, address_seed, google_iss)`).
// FAST PATH: the Enoki session's zkLogin proof (`ZkLoginSignatureInputs`) carries the seed — but Enoki
// generates that proof LAZILY on the first SIGN (wallet.mjs `createZkLoginZkp`), so a fresh Google login
// reaching first-create has never signed → `session.proof` is undefined (a P0 bug). DERIVE PATH:
// the seed is fully determined by (salt, sub, aud) — fetch the account salt from Enoki (`getZkLogin({jwt})`,
// same API key registerEnokiWallets uses) and compute it (zklogin_seed.ts), with the MANDATORY guard that
// the derived seed reproduces the connected session address (mismatch = refuse client-side; a wrong seed
// would also refuse at the pre-flight dry-run with zero gas). Throws a humanized, i18n'd error when the wallet is
// not Enoki/zkLogin or the derivation refuses: the free path is zkLogin-ONLY by design (one Google account
// ⇒ one derived address ⇒ one free character — the sybil economics). NEVER guesses a seed.
export async function get_zklogin_address_seed(wallet_name: string): Promise<string> {
  const wallet = find_wallet(wallet_name)
  const feature = wallet?.features['enoki:getSession'] as
    { getSession: () => Promise<{ jwt?: string; proof?: { addressSeed?: string } } | null> } | undefined
  if (!feature?.getSession) throw new Error(i18n.t('errors.zklogin_required'))
  // getSession itself can REJECT for a fresh / second Enoki session whose state isn't ready. Left unguarded
  // (it sat outside the derive try/catch below), that raw Enoki rejection leaked past every user surface into
  // the create flow's generic tx decoder — mislabelling a pre-send session-read failure as "failed on-chain"
  // (nothing was ever sent). Guard it: the same honest zkLogin-required copy the derive path throws, mechanical
  // cause kept in the console (no-silent-failure law).
  let session: { jwt?: string; proof?: { addressSeed?: string } } | null
  try {
    session = await feature.getSession()
  } catch (e) {
    game_log('auth', 'zkLogin getSession failed:', e)
    throw new Error(i18n.t('errors.zklogin_required'))
  }
  const proof_seed = session?.proof?.addressSeed
  if (proof_seed) return String(proof_seed)
  const jwt = session?.jwt
  const address = wallet?.accounts[0]?.address
  if (!jwt || !address) throw new Error(i18n.t('errors.zklogin_required'))
  try {
    const { salt } = await new EnokiClient({ apiKey: ENOKI_API_KEY }).getZkLogin({ jwt })
    return derive_zklogin_seed({ jwt, salt, address })
  } catch (e) {
    // no-silent-failure law: keep the mechanical cause in the console; the player gets the humanized toast
    game_log('auth', 'zkLogin seed derivation failed:', e)
    throw new Error(i18n.t('errors.zklogin_required'))
  }
}

export interface AuthState {
  address: string | null
  wallet_name: string | null
  is_loading: boolean
  // Current wallet SUI balance in MIST — the SINGLE shared figure the wallet bar, characters drawer and send
  // modal all read. `refresh_sui_balance` is its ONLY writer (the single-home fix).
  sui_balance_mist: bigint | null
  // Epoch time of the last SUCCESSFUL read. Routing treats a missing/>30s timestamp as stale and asks the sponsor
  // first; the display may still retain the last-known amount through a transient read failure.
  sui_balance_read_at_ms: number | null
  // Refetch the balance FRESH and store it (or null when signed out). Invalidated on: wallet-bar focus/
  // visibility + mount, any balance-surface mount, and every executed tx. Event-driven — no polling loop.
  refresh_sui_balance: () => Promise<void>
  login: (name: string) => Promise<string | null>
  logout: () => Promise<void>
}

export const use_auth = create<AuthState>((set, get) => ({
  address: null,
  wallet_name: null,
  is_loading: true,
  sui_balance_mist: null,
  sui_balance_read_at_ms: null,
  refresh_sui_balance: async () => {
    const { address } = get()
    if (!address) {
      set({ sui_balance_mist: null, sui_balance_read_at_ms: null })
      return
    }
    // A transient read failure returns null → KEEP the last-known figure (never blank the display).
    const mist = await read_sui_balance_mist(address)
    // The address guard prevents an A→B/logout race from landing A's delayed read in the new session.
    if (mist !== null && get().address === address) set({ sui_balance_mist: mist, sui_balance_read_at_ms: Date.now() })
  },

  login: async (name: string) => {
    set({ is_loading: true })
    const result = await connect_wallet(name)
    if (result) {
      try {
        localStorage.setItem('last_wallet', result.wallet_name)
      } catch {
        /* storage unavailable (private mode) — auto-reconnect is best-effort */
      }
      set({
        address: result.address,
        wallet_name: result.wallet_name,
        is_loading: false,
        sui_balance_mist: null,
        sui_balance_read_at_ms: null,
      })
      return result.address
    }
    set({ is_loading: false })
    return null
  },

  logout: async () => {
    await disconnect_wallet(get().wallet_name)
    try {
      localStorage.removeItem('last_wallet')
    } catch {
      /* storage unavailable (private mode) — nothing to clear */
    }
    // DEV-only: drop the sticky dev-login marker so a dev actually signs out (else the persisted
    // ?dev session would re-authenticate on the next boot). Build-stripped in prod (DEV branch +
    // the dev_wallet module is dynamically imported only here, so it stays tree-shaken).
    if (import.meta.env.DEV) {
      try {
        const { clear_dev_login } = await import('./dev_wallet')
        clear_dev_login()
      } catch {
        /* dev_wallet module unavailable — nothing to clear */
      }
    }
    set({ address: null, wallet_name: null, sui_balance_mist: null, sui_balance_read_at_ms: null })
  },
}))

// WALLET-SWITCH SESSION RESET (P0/D286): the account-change trigger is installed at the composition root,
// NOT here — see auth/session_reset_subscription.ts. It stays out of auth's module body on purpose: naming
// the lazy game chunk from the eager login bundle made auth the head of an import cycle
// (auth → game/wallet_session_reset → … → auth). The subscription semantics are unchanged and still
// route-independent (installed above the router in main.tsx).

// Sentry pseudonymous user = the connected wallet address (on-chain data ONLY — never email/Google). This is
// the single home that OWNS the identity, so it owns telling the reporter who's playing. No-op until Sentry inits.
use_auth.subscribe((state, prev) => {
  if (state.address !== prev.address) set_report_user(state.address)
})

// ---------------------------------------------------------------------------
//  One-way session bridge (companion -> game engine)
// ---------------------------------------------------------------------------

export interface GameSession {
  wallet: WalletStandard
  account: WalletAccount
  address: string
}

// The companion's authenticated session, shaped for the game engine's action/sui_login. The
// companion auth is the SINGLE source of truth; the game-world tab consumes this session (login ->
// connect -> wait_until_online) and never flows anything back. Resolves the live wallet/account from
// the window-global wallet-standard registry by the connected name. null when there is no session.
export function current_session(): GameSession | null {
  const { address, wallet_name } = use_auth.getState()
  if (!address || !wallet_name) return null
  const wallet = find_wallet(wallet_name)
  if (!wallet) return null
  const account = wallet.accounts.find((a) => a.address === address) ?? wallet.accounts[0]
  if (!account) return null
  return { wallet, account, address }
}

// Auto-reconnect from localStorage
function reconnect_last(): void {
  const last = (() => {
    try {
      return localStorage.getItem('last_wallet')
    } catch {
      return null
    }
  })()
  if (!last) {
    use_auth.setState({ is_loading: false })
    return
  }
  setTimeout(async () => {
    try {
      const result = await connect_wallet(last)
      if (result) {
        use_auth.setState({
          address: result.address,
          wallet_name: result.wallet_name,
          is_loading: false,
          sui_balance_mist: null,
          sui_balance_read_at_ms: null,
        })
      } else {
        use_auth.setState({ is_loading: false })
      }
    } catch {
      use_auth.setState({ is_loading: false })
    }
  }, 100)
}

async function boot_auth(): Promise<void> {
  // DEV-ONLY native-wallet bypass — gated on import.meta.env.DEV (statically false in the prod
  // build → this dynamic import + its crypto are tree-shaken out, so the bypass is provably ABSENT
  // from production). Lets Playwright / local dev play the real UI with a local testnet key, no
  // Google popup. No prod escape hatch (no VITE_OWNER_PLAY).
  if (import.meta.env.DEV) {
    try {
      const { is_dev_login, dev_session } = await import('./dev_wallet')
      if (is_dev_login()) {
        const s = dev_session(graphql_client)
        dev_wallet = s.wallet
        use_auth.setState({
          address: s.address,
          wallet_name: s.wallet.name,
          is_loading: false,
          sui_balance_mist: null,
          sui_balance_read_at_ms: null,
        })
        return
      }
    } catch (err) {
      game_log('auth', 'dev-wallet bypass unavailable:', err)
    }
  }
  reconnect_last()
}

void boot_auth()
