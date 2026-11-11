// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { createRoot } from 'react-dom/client'
import { toZkLoginPublicIdentifier } from '@mysten/sui/zklogin'

import { load_app_copy } from '../../src/i18n/copy.ts'
import { LOCALES } from '../../src/i18n/locale.ts'
import SettingsPage from '../../src/settings/SettingsPage.tsx'
import { dispatch_app, observe_app, read_app_state, useAppStore } from '../../src/store.ts'
import '../../src/tailwind.css'

// Synthetic SDK effects only. Playwright intercepts every hosted request; no wallet or chain is contacted.
const parameters = new URLSearchParams(location.search)
const locale = LOCALES.find(({ code }) => code === parameters.get('locale'))?.code ?? 'en'
const copy = await load_app_copy(locale)
const external = parameters.get('state') === 'external'
const google = toZkLoginPublicIdentifier(1n, 'https://accounts.google.com', { legacyAddress: false })
const held = Promise.withResolvers<void>()
document.addEventListener('fixture/release', () => held.resolve())
const chain = { default_name: external ? 'branch.owner.sui' : (null as string | null), human: 0, agent: 0, attempts: 0 }
const metric = (name: string, value: number | string) => document.body.setAttribute(`data-${name}`, String(value))
const wallet = {
  address: google.toSuiAddress(),
  wallet_name: external ? 'External' : 'Google',
  identity: external ? 'wallet' : 'zklogin',
  read_agent_pairing_request: (nonce: string) => ({
    version: 1,
    network: 'mainnet',
    nonce,
    owner: google.toSuiAddress(),
    zklogin_public_identifier: google.toBase64(),
  }),
  sign_personal_message: async () => ({ signature: 'fixture-owner-proof' }),
  suins: {
    managed: !external,
    snapshot: async () => ({
      default_name: chain.default_name,
      names: external ? [] : [{ name: 'branch.mine.sui', object_id: '0x2', nft_id: '0x3', subname: true }],
    }),
    validate_parent: async (_name: string, before_sign: () => void) => {
      before_sign()
      metric('name-stage', 'validation')
      if (parameters.get('hold') === 'validation') await held.promise
      before_sign()
    },
    apply_parent: async (name: string, agent: string, before_sign: () => void) => {
      before_sign()
      metric('human-target', wallet.address)
      metric('agent-target', agent)
      if (chain.default_name !== `aresrpg.${name}`) chain.human++
      chain.default_name = `aresrpg.${name}`
      metric('human-writes', chain.human)
      return { name: chain.default_name, digest: 'fixture-only' }
    },
  },
  set_agent_default: async (_pairing: unknown, name: string, before_sign: () => void) => {
    before_sign()
    metric('agent-attempts', ++chain.attempts)
    if (parameters.get('state') === 'partial')
      throw new Error('[sdk] transaction resolution failed — NOT submitted: InsufficientGas')
    metric('agent-default', name)
    metric('agent-writes', ++chain.agent)
  },
}
metric('human-writes', 0)
metric('agent-writes', 0)
metric('agent-attempts', 0)
dispatch_app({ type: 'locale/loaded', locale, copy })
dispatch_app({ type: 'auth/connecting' })
dispatch_app({ type: 'auth/connected', session: wallet as never })
observe_app(['suins'])
dispatch_app({ type: 'page/open', page: 'settings' })
const Probe = () => {
  const page = useAppStore(({ navigation }) => navigation.page)
  return page === 'settings' ? (
    <SettingsPage copy={copy} settings={read_app_state().settings} />
  ) : (
    <p>Settings closed</p>
  )
}
createRoot(document.getElementById('root')!).render(<Probe />)
