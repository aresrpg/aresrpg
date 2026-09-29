// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { createContext, useContext } from 'react'

import { dispatch_app, useAppStore, type AppInput, type AppState } from '../store.ts'
export type MasterySource = Readonly<{
  mastery: AppState['mastery']
  characters: AppState['session']['characters']
  current_epoch: string | null
  connected: boolean
  balance: bigint | null
  dispatch: (input: AppInput) => void
}>
export const MasterySourceContext = createContext<MasterySource | null>(null)
export const useMasterySource = (): MasterySource => {
  const source = useContext(MasterySourceContext)
  const mastery = useAppStore((state) => state.mastery)
  const session = useAppStore((state) => state.session)
  return (
    source ?? {
      mastery,
      characters: session.characters,
      current_epoch: session.current_epoch,
      connected: !!session.wallet && session.link_status === 'ready',
      balance: session.kares_balance,
      dispatch: dispatch_app,
    }
  )
}
