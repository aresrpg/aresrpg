// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { registerEnokiWallets } from '@mysten/enoki'
import { getWallets } from '@mysten/wallet-standard'
import type { Wallet as WalletStandard } from '@mysten/wallet-standard'

import { game_log } from '../core/log.js'

type ProofCallSite = 'sign_transaction' | 'sign_personal_message' | 'sign_and_execute_transaction'

type ProofRetryInput<Materials, Proof> = Readonly<{
  call_site: ProofCallSite
  initial_materials: Materials
  create_proof: (materials: Materials) => Promise<Proof>
  rederive_materials: () => Promise<Materials>
  log_400_response: (response_body: string) => void
}>

type Captured<Value> = { ok: true; value: Value } | { ok: false; error: unknown }

type EnokiError = {
  name?: unknown
  status?: unknown
  response_body?: unknown
  errors?: unknown
}

type EnokiSessionFeature = {
  getSession: (input?: Readonly<{ network?: string }>) => Promise<unknown>
}

type AsyncMethod = (...args: readonly unknown[]) => Promise<unknown>

const capture = async <Value>(effect: () => Promise<Value>): Promise<Captured<Value>> => {
  try {
    return { ok: true, value: await effect() }
  } catch (error) {
    return { ok: false, error }
  }
}

const enoki_400_response_body = (error: unknown): string | null => {
  const enoki_error = error as EnokiError | null
  if (enoki_error?.name !== 'EnokiClientError' || enoki_error.status !== 400) return null
  if (typeof enoki_error.response_body === 'string') return enoki_error.response_body
  return JSON.stringify({ errors: enoki_error.errors ?? [] })
}

// SSOT: only gasless signing calls may re-enter lazy proof creation; a call that can submit stays single-shot.
const retry_allowed = (call_site: ProofCallSite): boolean =>
  call_site === 'sign_transaction' || call_site === 'sign_personal_message'

const proof_unavailable = (cause: unknown): Error & { code: 'zklogin_proof_unavailable' } =>
  Object.assign(new Error('zkLogin proof unavailable', { cause }), { code: 'zklogin_proof_unavailable' as const })

export const create_zklogin_zkp_with_retry = async <Materials, Proof>({
  call_site,
  initial_materials,
  create_proof,
  rederive_materials,
  log_400_response,
}: ProofRetryInput<Materials, Proof>): Promise<Proof> => {
  const first = await capture(() => create_proof(initial_materials))
  if (first.ok) return first.value

  const response_body = enoki_400_response_body(first.error)
  if (response_body === null) throw first.error
  log_400_response(response_body)
  if (!retry_allowed(call_site)) throw proof_unavailable(first.error)

  const rederived = await capture(rederive_materials)
  if (!rederived.ok) throw proof_unavailable(rederived.error)

  const second = await capture(() => create_proof(rederived.value))
  if (second.ok) return second.value
  throw proof_unavailable(second.error)
}

// ── the expired-session gate (#2192) ─────────────────────────────────────────
// Enoki's signer recovers a dead session by RE-RUNNING THE OAUTH FLOW: `#getKeypair` opens a popup whenever
// `!session?.jwt || Date.now() > session.expiresAt` (wallet.mjs). Inside a sign call that popup has no user
// activation behind it — the browser blocks it and the sign rejects with `Failed to open popup`, which is a
// class already sitting in our error store. It is unfixable at the sign: a popup needs a click, and by then
// the player has committed to a transaction. So the wrapper asks the SAME question Enoki asks, one step
// earlier, and refuses as data — pre-network, pre-build, zero gas — with copy that names the actual remedy.
//
// The app can be fully "signed in" while this is true: the connected address lives in Enoki's zkLogin STATE
// store, which outlives the session store the signer reads.
type ZkLoginSessionShape = { jwt?: unknown; expiresAt?: unknown } | null | undefined

/** Enoki's own gate, as a predicate: will the next sign have to re-authenticate? PURE. */
export const zklogin_session_unusable = (session: ZkLoginSessionShape, now_ms: number): boolean => {
  if (session == null || typeof session !== 'object') return true
  if (typeof session.jwt !== 'string' || !session.jwt) return true
  return typeof session.expiresAt === 'number' && now_ms > session.expiresAt
}

export const zklogin_session_expired_error = (): Error & { code: 'zklogin_session_expired' } =>
  Object.assign(new Error('zkLogin session expired'), { code: 'zklogin_session_expired' as const })

/** Does this rejection mean the player must sign in again (rather than retry)? PURE. */
export const is_zklogin_session_expired = (error: unknown): boolean =>
  (error as { code?: unknown } | null)?.code === 'zklogin_session_expired'

const network_from = (args: readonly unknown[]): string | undefined => {
  const chain = (args[0] as { chain?: unknown } | undefined)?.chain
  return typeof chain === 'string' ? chain.split(':')[1] : undefined
}

/** Read the session without ever failing the sign for the READ: an unreadable session is not a verdict. */
const session_or_unknown = async (
  get_session: EnokiSessionFeature | undefined,
  args: readonly unknown[]
): Promise<ZkLoginSessionShape | 'unknown'> => {
  if (!get_session?.getSession) return 'unknown'
  try {
    return (await get_session.getSession({ network: network_from(args) })) as ZkLoginSessionShape
  } catch {
    return 'unknown'
  }
}

const proof_safe_method =
  (method: AsyncMethod, call_site: ProofCallSite, get_session: EnokiSessionFeature | undefined): AsyncMethod =>
  async (...args) => {
    const session = await session_or_unknown(get_session, args)
    if (session !== 'unknown' && zklogin_session_unusable(session, Date.now())) throw zklogin_session_expired_error()
    return create_zklogin_zkp_with_retry({
      call_site,
      initial_materials: args,
      create_proof: (materials) => method(...materials),
      // Enoki keeps proof inputs private. Re-entering its sign method after this hydrated session read makes
      // getKeypair re-read/import the ephemeral signer plus maxEpoch/randomness before createZkLoginZkp runs.
      rederive_materials: async () => {
        await get_session?.getSession({ network: network_from(args) })
        return args
      },
      log_400_response: (response_body) =>
        game_log('auth', 'Enoki zkLogin proof request rejected (400):', response_body),
    })
  }

export const with_proof_retry = (wallet: WalletStandard): WalletStandard => ({
  get version() {
    return wallet.version
  },
  get name() {
    return wallet.name
  },
  get icon() {
    return wallet.icon
  },
  get chains() {
    return wallet.chains
  },
  get accounts() {
    return wallet.accounts
  },
  get features() {
    const { features } = wallet
    const get_session = features['enoki:getSession'] as EnokiSessionFeature | undefined
    const sign_transaction = features['sui:signTransaction'] as
      { version: string; signTransaction: AsyncMethod } | undefined
    const sign_personal_message = features['sui:signPersonalMessage'] as
      { version: string; signPersonalMessage: AsyncMethod } | undefined
    const sign_and_execute = features['sui:signAndExecuteTransaction'] as
      { version: string; signAndExecuteTransaction: AsyncMethod } | undefined
    return {
      ...features,
      ...(sign_transaction
        ? {
            'sui:signTransaction': {
              ...sign_transaction,
              signTransaction: proof_safe_method(sign_transaction.signTransaction, 'sign_transaction', get_session),
            },
          }
        : {}),
      ...(sign_personal_message
        ? {
            'sui:signPersonalMessage': {
              ...sign_personal_message,
              signPersonalMessage: proof_safe_method(
                sign_personal_message.signPersonalMessage,
                'sign_personal_message',
                get_session
              ),
            },
          }
        : {}),
      // This wrapper gives a proof 400 plain player copy but the helper's call-site gate forbids its retry.
      ...(sign_and_execute
        ? {
            'sui:signAndExecuteTransaction': {
              ...sign_and_execute,
              signAndExecuteTransaction: proof_safe_method(
                sign_and_execute.signAndExecuteTransaction,
                'sign_and_execute_transaction',
                get_session
              ),
            },
          }
        : {}),
    } as WalletStandard['features']
  },
})

export const register_enoki_wallets_with_zkp_retry = (
  options: Readonly<Parameters<typeof registerEnokiWallets>[0]>
): (() => void) => {
  const registration = registerEnokiWallets(options)
  registration.unregister()
  const wallets = Object.values(registration.wallets)
    .filter((wallet): wallet is NonNullable<typeof wallet> => wallet != null)
    .map(with_proof_retry)
  return getWallets().register(...wallets)
}
