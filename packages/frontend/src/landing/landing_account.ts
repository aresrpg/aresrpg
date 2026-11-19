// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The home page's view of the shared sign-in: one small state, fed by the remembered sign-in service.
import { createStore } from 'zustand/vanilla'

import type { AuthSession } from '../auth.ts'
import { create_remembered_auth, type RememberedAuth } from '../remembered_auth.ts'

export type LandingAccountState = Readonly<{
  status: 'signed_out' | 'restoring' | 'connecting' | 'signed_in'
  address: string | null
  /** The last sign-in did not complete. Cleared by the next attempt. */
  failed: boolean
  /** This account's request to join the Telegram waitlist. Every sign-in and sign-out starts it over. */
  waitlist: 'idle' | 'joining' | 'joined' | 'failed'
}>
type Input =
  | Readonly<{ type: 'restore' | 'connect' | 'signed_out' | 'failed' }>
  | Readonly<{ type: 'connected'; address: string }>
  | Readonly<{ type: 'waitlist'; step: 'joining' | 'joined' | 'failed' }>

export const initial_landing_account: LandingAccountState = {
  status: 'signed_out',
  address: null,
  failed: false,
  waitlist: 'idle',
}

const busy = ({ status }: LandingAccountState): boolean => status === 'restoring' || status === 'connecting'
const begin = (state: LandingAccountState, status: 'restoring' | 'connecting'): LandingAccountState =>
  state.status === 'signed_out' ? { ...initial_landing_account, status } : state
/** A result counts only while a sign-in is in flight. */
const settle_with = (state: LandingAccountState, next: LandingAccountState): LandingAccountState =>
  busy(state) ? next : state
/** Only a signed-in account joins, one request at a time and never twice. A result counts only while one is in flight. */
const waitlist_step = (state: LandingAccountState, step: 'joining' | 'joined' | 'failed'): LandingAccountState => {
  const open = state.status === 'signed_in' && (state.waitlist === 'idle' || state.waitlist === 'failed')
  const accepted = step === 'joining' ? open : state.waitlist === 'joining'
  return accepted ? { ...state, waitlist: step } : state
}

export const reduce_landing_account = (state: LandingAccountState, input: Input): LandingAccountState => {
  switch (input.type) {
    case 'restore':
      return begin(state, 'restoring')
    case 'connect':
      return begin(state, 'connecting')
    case 'connected':
      return settle_with(state, { ...initial_landing_account, status: 'signed_in', address: input.address })
    case 'failed':
      // A remembered wallet that no longer restores is an ordinary signed-out visit, not an error to show.
      return settle_with(state, { ...initial_landing_account, failed: state.status === 'connecting' })
    case 'signed_out':
      return initial_landing_account
    case 'waitlist':
      return waitlist_step(state, input.step)
  }
}

/** Stores the address on the hosted bot once this browser proved it owns it. Loaded on first use. */
const join_telegram_waitlist = async (session: AuthSession): Promise<void> =>
  (await import('./telegram_waitlist.ts')).join_telegram_waitlist(session)

/** What Play does next. It reads the current state every time, so a settled restore can never re-enter itself. */
export const play_step = (status: LandingAccountState['status']): 'enter' | 'wait' | 'login' => {
  if (status === 'signed_in') return 'enter'
  return status === 'signed_out' ? 'login' : 'wait'
}

export const create_landing_account = (
  auth: RememberedAuth = create_remembered_auth(),
  join: (session: AuthSession) => Promise<void> = join_telegram_waitlist
) => {
  const store = createStore<LandingAccountState>(() => initial_landing_account)
  const dispatch = (input: Input): void => store.setState((state) => reduce_landing_account(state, input), true)
  let session: AuthSession | null = null
  let active = true

  /** Resolves true once the visitor is signed in. Every outcome re-enters the reducer as an input. */
  const settle = async (connect: () => Promise<AuthSession | null>): Promise<boolean> => {
    try {
      const connected = await connect()
      if (!connected || !active) {
        connected?.dispose?.()
        dispatch({ type: 'failed' })
        return false
      }
      session = connected
      dispatch({ type: 'connected', address: connected.address })
      return true
    } catch (error) {
      console.error('Sign-in did not complete.', error)
      dispatch({ type: 'failed' })
      return false
    }
  }

  /** Google through Enoki is the only sign-in here. Resolves true once the visitor is signed in. */
  const login = async (): Promise<boolean> => {
    if (store.getState().status === 'signed_in') return true
    if (store.getState().status !== 'signed_out') return false
    dispatch({ type: 'connect' })
    return settle(() => auth.connect())
  }

  return {
    store,
    /** A wallet was remembered when the page loaded: this visitor has played before. */
    returning: auth.returning,
    restore: async (): Promise<boolean> => {
      if (!auth.returning || store.getState().status !== 'signed_out') return false
      dispatch({ type: 'restore' })
      return settle(auth.restore)
    },
    login,
    /** Joins the Telegram waitlist as the signed-in account. A signed-out visitor signs in first. */
    join_waitlist: async (): Promise<void> => {
      if (!(await login())) return
      const joining = session
      const before = store.getState()
      dispatch({ type: 'waitlist', step: 'joining' })
      // An unchanged state is the reducer's refusal: already joining, or already joined.
      if (!joining || store.getState() === before) return
      const step = await join(joining).then(
        () => 'joined' as const,
        (error: unknown) => {
          console.error('Joining the Telegram waitlist did not complete.', error)
          return 'failed' as const
        }
      )
      // A result belongs to the account that asked for it.
      if (session === joining) dispatch({ type: 'waitlist', step })
    },
    /** Loads the sign-in code ahead of the click, so the provider popup opens inside the user's gesture. */
    warm: (): void => {
      void auth.provider().catch((error: unknown) => console.error('The sign-in code could not load.', error))
    },
    logout: async (): Promise<void> => {
      const previous = session
      session = null
      dispatch({ type: 'signed_out' })
      try {
        await auth.sign_out(previous)
      } catch (error) {
        console.error('The account could not be disconnected cleanly.', error)
      } finally {
        previous?.dispose?.()
      }
    },
    /** Hands over to the game: the session object is released, the remembered wallet stays. */
    dispose: (): void => {
      active = false
      session?.dispose?.()
      session = null
      auth.dispose()
    },
  }
}

export type LandingAccountRuntime = ReturnType<typeof create_landing_account>
