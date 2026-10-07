// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { GiftError, type GiftAction, type GiftProof, type GiftStatus } from '@aresrpg/sdk/gift'
import { item_template_id } from '@aresrpg/sdk/seed-ids'
import { living_content, resolve_pins } from '@aresrpg/sdk/pins'

import { GiftPage } from '../../src/airdrop/GiftPage.tsx'
import { create_gift_runtime } from '../../src/airdrop/gift_runtime.ts'
import type { GiftWallet } from '../../src/airdrop/gift_state.ts'
import { load_app_copy } from '../../src/i18n/copy.ts'
import { env } from '../../src/env.ts'
import '../../src/tailwind.css'

// Real view/reducer/observer; only the external account and chain adapters are fixtures.
const params = new URLSearchParams(location.search)
const { content_root, seed_package_original } = living_content({ pins: resolve_pins(env.network) }, 'Fixture')
const template = (name: string) => item_template_id(content_root, seed_package_original, name)
const id = (digit: string) => `0x${digit.repeat(64)}`
const giftcard = id('1')
const digests = {
  redeem: '5SCHgCXXbS66HhSqPJ6j55pNDVdmg7mwPEFv6KnNGGuc',
  open: 'HHJheC5z9CGLWRvbz5b1bYtxwGWnDpYMb4six4rwgTyy',
  collect: 'AiJJxoVs2uXm7Ca9ivFKEQyHbuPE6wMF6VA8zoGaZtVr',
}
const ledger_key = 'fixture:gift-chain'
type Ledger = { stage: GiftStatus['stage']; proof: GiftProof; calls: string[]; pending: GiftAction | null }
const read_ledger = (): Ledger =>
  (JSON.parse(localStorage.getItem(ledger_key) ?? 'null') as Ledger) ?? {
    stage: 'available',
    proof: { giftcard },
    calls: [],
    pending: null,
  }
const save = (ledger: Ledger): void => {
  localStorage.setItem(ledger_key, JSON.stringify(ledger))
  document.body.dataset.giftCalls = ledger.calls.join(',')
}
const wait = () => new Promise<void>((resolve) => setTimeout(resolve, 30))
const status = (): GiftStatus => ({
  stage: params.has('used') ? 'missing' : read_ledger().stage,
  proof: params.has('used') ? null : read_ledger().proof,
  kiosk: id('3'),
  crate: id('4'),
  ...(['reward', 'collected'].includes(read_ledger().stage)
    ? { claim: id('5'), reward_template: template('sui_helmet'), amount: 1 }
    : {}),
  ...(read_ledger().stage === 'collected' ? { item: id('6') } : {}),
})
const create_wallet = (): GiftWallet => {
  const confirm = (action: GiftAction): void => {
    const ledger = read_ledger()
    save({
      ...ledger,
      stage: { redeem: 'crate', open: 'reward', collect: 'collected' }[action] as GiftStatus['stage'],
      proof: { ...ledger.proof, [action]: digests[action] },
      pending: null,
    })
  }
  return {
    address: id('2'),
    wallet_name: 'Fixture Google',
    identity: 'zklogin',
    disconnect: async () => {},
    inspect_giftcard_link: async () =>
      params.has('used') || read_ledger().stage !== 'available'
        ? null
        : { id: giftcard, template: template('sui_crate'), amount: 1 },
    claim_giftcard_link: async () => {
      await wait()
      const ledger = read_ledger()
      save({ ...ledger, stage: 'voucher', calls: [...ledger.calls, 'transfer'] })
      return { digest: digests.redeem, giftcard: { id: giftcard, template: template('sui_crate'), amount: 1 } }
    },
    gift: {
      status: async () => {
        await wait()
        return status()
      },
      recover: async () => {
        await wait()
        const { pending } = read_ledger()
        if (!pending) return false
        confirm(pending)
        return true
      },
      execute: async (action) => {
        await wait()
        const ledger = read_ledger()
        save({ ...ledger, calls: [...ledger.calls, action] })
        if (params.get('fail') === action) throw new GiftError('sponsor_unavailable')
        if (params.has('uncertain') && action === 'open') {
          save({ ...read_ledger(), pending: 'open' })
          throw new Error('transaction outcome unknown')
        }
        confirm(action)
        return { digest: digests[action] }
      },
    },
  }
}
save(read_ledger())
const runtime = create_gift_runtime({
  link: `${location.origin}/gift#$fixture-card`,
  load_auth: async () => () => ({
    connect_google: async () => {
      await wait()
      return create_wallet()
    },
    restore: async () => {
      await wait()
      return create_wallet()
    },
    dispose: () => {},
  }),
})
const copy = await load_app_copy('en')
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <GiftPage runtime={runtime} copy={copy} />
  </StrictMode>
)
