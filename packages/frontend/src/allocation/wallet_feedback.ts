// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { useEffect, useRef } from 'react'

import { play_audio } from '../game/audio/audio_registry.ts'

import type { AllocationState } from './runtime.ts'

type Portfolio = Readonly<{ owner: string | null; addresses: readonly string[] }>
export const added_wallets = (previous: Portfolio | null, current: Portfolio): readonly string[] =>
  previous?.owner && previous.owner === current.owner
    ? current.addresses.filter((address) => !previous.addresses.includes(address))
    : []

/** Observe verified address additions, never request arrivals or portfolio hydration. */
export const useWalletFeedback = (state: AllocationState) => {
  const root = useRef<HTMLDivElement>(null)
  const previous = useRef<Portfolio | null>(null)
  useEffect(() => {
    const current = state.status
      ? { owner: state.session?.address ?? null, addresses: state.status.wallets.map(({ address }) => address) }
      : null
    const added = current ? added_wallets(previous.current, current) : []
    // eslint-disable-next-line functional/immutable-data -- this effect retains only the observed portfolio identity and address set to prevent replay.
    previous.current = current
    if (!added.length) return
    play_audio('menu_button', 0.25)
    const elements = Array.from(root.current?.querySelectorAll<HTMLElement>('[data-allocation-wallet]') ?? []).filter(
      (element) => added.includes(element.dataset.allocationWallet!)
    )
    elements.forEach((element) => element.classList.add('is-new'))
    return () => elements.forEach((element) => element.classList.remove('is-new'))
  }, [state.session?.address, state.status])
  return root
}
