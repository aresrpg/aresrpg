// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { createRoot } from 'react-dom/client'

import type { AuthSession } from '../../src/auth.ts'
import { GiftClaimNotice, gift_funding_text } from '../../src/airdrop/GiftClaimNotice.tsx'
import { AddFundsModal } from '../../src/components/AddFundsModal.tsx'
import { load_app_copy } from '../../src/i18n/copy.ts'
import { rolled_item_types } from '../../src/modules/claims.ts'
import { dispatch_app, observe_app, useAppStore } from '../../src/store.ts'
import { on_gas_empty } from '../../src/toast.ts'
import '../../src/tailwind.css'

const params = new URLSearchParams(location.search)
const copy = await load_app_copy('en')
const [template] = [...rolled_item_types()].find(([, type]) => type === 'sui_crate')!
const card = { id: 'fixture-gift', template, amount: 1 }
let funded = false
let claims = 0
const wallet = {
  address: 'fixture-recipient',
  identity: 'zklogin',
  claim_giftcard_link: async () => (params.has('used') ? null : { digest: 'fixture-transfer', giftcard: card }),
  redeem_giftcards: async () => {
    claims++
    document.body.dataset.claims = String(claims)
    if (params.has('gas') && !funded) throw new Error('no valid gas coin')
    return { digest: 'fixture-redemption' }
  },
} as unknown as AuthSession

// Synthetic intent and wallet: this fixture never signs, fetches chain state, or spends funds.
sessionStorage.setItem('aresrpg:gift-link', `${location.origin}/claim#$fixture`)
dispatch_app({ type: 'locale/loaded', locale: 'en', copy })
observe_app(['distribution'])
on_gas_empty(() => dispatch_app({ type: 'dialog/open', dialog: 'top_up' }))
dispatch_app({ type: 'auth/connecting' })
dispatch_app({ type: 'auth/connected', session: wallet })
dispatch_app({ type: 'server/packet', packet: { type: 'packet/characters', characters: [] } })

const App = () => {
  const state = useAppStore((state) => state)
  return (
    <main>
      <button
        type="button"
        onClick={() => dispatch_app({ type: 'server/packet', packet: { type: 'packet/giftcards', giftcards: [card] } })}
      >
        Replay snapshot
      </button>
      <GiftClaimNotice copy={copy} />
      {state.navigation.dialog === 'top_up' && (
        <AddFundsModal
          address={wallet.address}
          copy={copy}
          network="testnet"
          warning={gift_funding_text(copy, state.distribution, state.session)}
          on_close={() => {
            funded = true
            dispatch_app({ type: 'dialog/open', dialog: null })
          }}
        />
      )}
    </main>
  )
}
createRoot(document.getElementById('root')!).render(<App />)
