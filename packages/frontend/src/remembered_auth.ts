// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The one owner of the remembered sign-in lifecycle: restore it, sign in, sign out, forget it.
// Every surface (game, site pages, gift, allocation) keeps its own state and consumes this service, so the
// rules "remember on success" and "forget a wallet that no longer restores" exist once.
import type { AuthSession } from './auth.ts'
import {
  browser_auth_storage,
  clear_auth_wallet,
  read_auth_wallet,
  remember_auth_wallet,
  type AuthStorage,
} from './auth_storage.ts'

type Session = Readonly<{
  wallet_name: string
  identity: 'zklogin' | 'wallet'
  disconnect: () => Promise<void>
  dispose?: () => void
}>
export type AuthProvider<S extends Session> = Readonly<{
  connect_google: () => Promise<S>
  restore: (wallet_name: string) => Promise<S | null>
  wallets?: () => readonly Readonly<{ name: string; connect: () => Promise<S> }>[]
  dispose: () => void
}>

const load_auth = async (): Promise<AuthProvider<AuthSession>> => (await import('./auth.ts')).create_auth()

export const create_remembered_auth = <S extends Session = AuthSession>(
  source: () => Promise<AuthProvider<S>> = load_auth as unknown as () => Promise<AuthProvider<S>>,
  storage: AuthStorage | null = browser_auth_storage(),
  /** Google through Enoki is the app's only identity. A surface that rules an installed wallet in says so here. */
  { wallets = false }: Readonly<{ wallets?: boolean }> = {}
) => {
  /** A session this surface may not use is released and treated as no sign-in; its owner surface keeps it remembered. */
  const accepted = (session: S | null): S | null => {
    if (!session || wallets || session.identity === 'zklogin') return session
    session.dispose?.()
    return null
  }
  let loading: Promise<AuthProvider<S>> | null = null
  /** The sign-in code loads once, on first use. */
  const provider = (): Promise<AuthProvider<S>> => (loading ??= source())
  return Object.freeze({
    /** A wallet was remembered when this surface started, whether or not it still restores. */
    returning: read_auth_wallet(storage) !== null,
    provider,
    /** The installed wallets this surface may sign in with, or null where Google is the only sign-in. */
    wallet_names: wallets
      ? async (): Promise<readonly string[]> => (await provider()).wallets?.().map(({ name }) => name) ?? []
      : null,
    /** Null when nothing is remembered. A wallet that no longer restores is forgotten before the failure surfaces. */
    restore: async (): Promise<S | null> => {
      const wallet_name = read_auth_wallet(storage)
      if (!wallet_name) return null
      try {
        const session = await (await provider()).restore(wallet_name)
        if (!session) clear_auth_wallet(storage)
        return accepted(session)
      } catch (error) {
        clear_auth_wallet(storage)
        throw error
      }
    },
    /** Signs in with Google, or with a named installed wallet where the surface rules wallets in, and remembers it. */
    connect: async (wallet: string | null = null): Promise<S> => {
      const auth = await provider()
      const choice = wallet === null || !wallets ? null : auth.wallets?.().find(({ name }) => name === wallet)
      if (wallet !== null && !choice) throw new Error('no_wallet_app')
      const session = await (choice ? choice.connect() : auth.connect_google())
      remember_auth_wallet(storage, session.wallet_name)
      return session
    },
    /** The session ended without a sign-out (expired or invalidated). */
    forget: (): void => clear_auth_wallet(storage),
    sign_out: async (session: S | null): Promise<void> => {
      clear_auth_wallet(storage)
      await session?.disconnect()
    },
    /** Releases the wallet registration before another surface creates its own. The remembered wallet stays. */
    dispose: (): void => {
      void loading
        ?.then((auth) => auth.dispose())
        .catch((error: unknown) => console.error('The sign-in could not be released.', error))
    },
  })
}

export type RememberedAuth<S extends Session = AuthSession> = ReturnType<typeof create_remembered_auth<S>>
