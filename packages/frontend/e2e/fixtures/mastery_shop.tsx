// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { useCallback, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { KARES_UNIT } from '@aresrpg/sdk/kares-economics'

import { load_app_copy } from '../../src/i18n/copy.ts'
import { MasteryShop } from '../../src/mastery/MasteryShop.tsx'
import { MasterySourceContext } from '../../src/mastery/MasterySource.tsx'
import { useFinance } from '../../src/kares/useFinance.ts'
import { FinanceStatus } from '../../src/kares/components.tsx'
import { toast, type Toast } from '../../src/toast.ts'
import { finance_session, finance_snapshot } from '../../test/kares/fixture.ts'
import type { AppInput } from '../../src/store.ts'
import '../../src/tailwind.css'
import '@aresrpg/ui/styles.css'

const copy = await load_app_copy('en')
const balance = BigInt(new URLSearchParams(location.search).get('balance') ?? '10000') * KARES_UNIT
const session = finance_session()
const wallet = {
  ...session,
  kares: {
    ...session.kares,
    staking_snapshot: async () => finance_snapshot(),
    stake: async () => ({ digest: 'confirmed-stake', receipt: {} }),
  },
}
const Fixture = () => {
  const [inputs, set_inputs] = useState<readonly AppInput[]>([])
  const dispatch = useCallback((input: AppInput) => {
    if (input.type === 'mastery/redeem') set_inputs((previous) => [...previous, input])
  }, [])
  const [messages, set_messages] = useState<readonly Toast[]>([])
  const finance = useFinance({ network: 'testnet', managed: true }, wallet, copy.kares_page.confirmed)
  useEffect(
    () =>
      toast.subscribe((event) => {
        if (event.type === 'show') set_messages((previous) => [...previous, event.toast])
      }),
    []
  )
  return (
    <main className="p-6 text-text">
      <MasterySourceContext
        value={{
          balance,
          connected: true,
          current_epoch: '1',
          characters: [],
          mastery: {
            loaded: true,
            row: null,
            pending: null,
            error: null,
            offers: [{ id: 'offer', item_type: 'resource_crate', template: 'template', cost: '2', enabled: true }],
          },
          dispatch,
        }}
      >
        <MasteryShop copy={copy} />
      </MasterySourceContext>
      <output data-inputs>{JSON.stringify(inputs)}</output>
      <button
        type="button"
        disabled={!finance.state.snapshot}
        onClick={() =>
          finance.dispatch({ type: 'request', request: { kind: 'execute', action: { kind: 'stake', amount: 1n } } })
        }
      >
        Confirm stake
      </button>
      <button type="button" onClick={() => finance.dispatch({ type: 'request', request: { kind: 'refresh' } })}>
        Refresh stake
      </button>
      <div data-finance-panel>
        <FinanceStatus state={finance.state} copy={copy.kares_page} />
      </div>
      <output data-toasts>{JSON.stringify(messages.map(({ message, type }) => ({ message, type })))}</output>
    </main>
  )
}
createRoot(document.getElementById('root')!).render(<Fixture />)
