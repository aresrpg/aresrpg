// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, spyOn, test } from 'bun:test'
import type { HostedBotDescriptor } from '@aresrpg/protocol'

import * as hosted from '../../src/agents/useHostedConnect.ts'
import { empty_hosted } from '../../src/agents/hosted_state.ts'
import { AgentSetup } from '../../src/agents/AgentSetup.tsx'
import { load_app_copy } from '../../src/i18n/copy.ts'
import { render_english } from '../i18n/render.ts'

test('the chooser keeps provider cards and Connect without technical setup prose', async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'location')
  Object.defineProperty(globalThis, 'location', { configurable: true, value: { search: '' } })
  try {
    const copy = await load_app_copy('en')
    const html = render_english(<AgentSetup copy={copy} close={() => {}} />)
    expect(html).toContain('/providers/claude.svg')
    expect(html).toContain('>Connect</button>')
    expect(html).toMatch(/<button[^>]*class="[^"]*mt-3[^"]*"[^>]*>Cancel<\/button>/)
    for (const key of [
      'agent_hosted_intro',
      'agent_hosted_unavailable',
      'agent_hosted_recovery',
      'agent_hosted_authenticate',
    ])
      expect(html).not.toContain(copy.ui[key]!)
    expect(html).toContain('ChatGPT')
    expect(html).toContain('Grok')
  } finally {
    if (previous) Object.defineProperty(globalThis, 'location', previous)
    else Reflect.deleteProperty(globalThis, 'location')
  }
})

test('hosted setup uses a loader and exposes no internal bot controls', async () => {
  const { HostedBotPanel } = await import('../../src/agents/HostedBotPanel.tsx')
  const { empty_hosted } = await import('../../src/agents/hosted_state.ts')
  const copy = await load_app_copy('en')
  const html = render_english(
    <HostedBotPanel copy={copy} provider="ChatGPT" state={empty_hosted()} dispatch={() => {}} />
  )
  expect(html).not.toContain('Create hosted bot')
  expect(html).not.toContain('Select your bot')
  expect(html).not.toContain('Verify hosted signer')
})

test.each(['authenticating', 'authorizing'] as const)(
  'pending %s renders only an accessible spinner, not wait prose',
  async (phase) => {
    const previous = Object.getOwnPropertyDescriptor(globalThis, 'location')
    Object.defineProperty(globalThis, 'location', { configurable: true, value: { search: '' } })
    const hook = spyOn(hosted, 'useHostedConnect').mockReturnValue({
      state: { ...empty_hosted<HostedBotDescriptor>(), phase },
      dispatch: () => {},
    })
    try {
      const copy = await load_app_copy('en')
      const html = render_english(<AgentSetup copy={copy} close={() => {}} />)
      expect(html).toContain('aria-busy="true"')
      expect(html).toContain('animate-spin')
      expect(html).toContain(`aria-label="${copy.ui.agent_hosted_pending}"`)
      expect(html).not.toContain(`>${copy.ui.agent_hosted_pending}<`)
      expect(html).not.toContain('Create hosted bot')
    } finally {
      hook.mockRestore()
      if (previous) Object.defineProperty(globalThis, 'location', previous)
      else Reflect.deleteProperty(globalThis, 'location')
    }
  }
)
