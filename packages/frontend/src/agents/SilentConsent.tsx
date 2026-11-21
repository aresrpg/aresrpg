// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { useEffect, useState, type ReactNode } from 'react'

import { env } from '../env.ts'
import { useAppStore } from '../store.ts'

import type { HostedStep } from './hosted_state.ts'
import { silent_step, type TrustedRequest } from './silent_consent.ts'
import { useHostedConnect } from './useHostedConnect.ts'

/**
 * A consent that finishes by itself: the request in the address is proved and approved with no button,
 * as long as the caller trusts it. The caller owns what the player sees: `busy` while it works,
 * `failed` when it failed or the request is not one the caller trusts. A `busy` function receives
 * the step in progress (null before one began), so the caller can name the wait. `arrive` takes the
 * approved redirect when this page is itself its destination; without it the browser leaves.
 */
export const SilentConsent = ({
  trusted,
  busy,
  failed,
  arrive,
}: Readonly<{
  trusted: TrustedRequest | null
  busy: ReactNode | ((step: HostedStep | null) => ReactNode)
  failed: ReactNode
  arrive?: (redirect: string) => void
}>) => {
  const wallet = useAppStore(({ session }) => session.wallet)
  const [authorization_id] = useState(() => new URLSearchParams(globalThis.location.search).get('authorization_id'))
  const { state, dispatch } = useHostedConnect(wallet, env.bot_service_url, authorization_id, arrive)
  const step = silent_step(state, trusted)
  useEffect(() => {
    if (step === 'authenticating' || step === 'authorizing') dispatch({ type: 'start', phase: step })
  }, [step, dispatch])
  if (state.phase === 'failed' || step === 'refused') return failed
  return typeof busy === 'function' ? busy(state.step) : busy
}
