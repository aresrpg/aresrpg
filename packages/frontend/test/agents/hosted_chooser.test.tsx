// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, spyOn, test } from 'bun:test'
import type { HostedBotDescriptor } from '@aresrpg/protocol'

import * as hosted from '../../src/agents/useHostedConnect.ts'
import { empty_hosted } from '../../src/agents/hosted_state.ts'
import { AgentSetup } from '../../src/agents/AgentSetup.tsx'
import { load_app_copy } from '../../src/i18n/copy.ts'
import { render_english } from '../i18n/render.ts'

test('standalone entry offers provider installation without a signing action', async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'location')
  Object.defineProperty(globalThis, 'location', { configurable: true, value: { search: '' } })
  try {
    const copy = await load_app_copy('en')
    const html = render_english(<AgentSetup copy={copy} close={() => {}} />)
    expect(html).toContain('/providers/claude.svg')
    expect(html).not.toContain('>Connect</button>')
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
  const html = render_english(<HostedBotPanel copy={copy} state={empty_hosted()} dispatch={() => {}} />)
  expect(html).not.toContain('Create hosted bot')
  expect(html).not.toContain('Select your bot')
  expect(html).not.toContain('Verify hosted signer')
})

test.each(['authenticating', 'authorizing'] as const)(
  'pending %s renders only an accessible spinner, not wait prose',
  async (phase) => {
    const previous = Object.getOwnPropertyDescriptor(globalThis, 'location')
    Object.defineProperty(globalThis, 'location', {
      configurable: true,
      value: { search: '?authorization_id=request' },
    })
    const hook = spyOn(hosted, 'useHostedConnect').mockReturnValue({
      state: { ...empty_hosted<HostedBotDescriptor>(), phase },
      dispatch: () => {},
      eligible: true,
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

test.each(['authorization', ''])(
  'provider return %s bypasses the chooser while keeping consent separate',
  async (id) => {
    const previous = Object.getOwnPropertyDescriptor(globalThis, 'location')
    Object.defineProperty(globalThis, 'location', { configurable: true, value: { search: `?authorization_id=${id}` } })
    const hook = spyOn(hosted, 'useHostedConnect').mockReturnValue({
      state: { ...empty_hosted<HostedBotDescriptor>(), phase: 'authenticating' },
      dispatch: () => {},
      eligible: true,
    })
    try {
      const copy = await load_app_copy('en')
      const html = render_english(<AgentSetup copy={copy} close={() => {}} />)
      expect(html).not.toContain('agent-provider-card')
      expect(html).not.toContain('>Connect</button>')
      expect(html).toContain('aria-busy="true"')
      expect(html).toContain(copy.ui.agent_hosted_consent!)
      expect(html).not.toContain('Approve this bot and access')
    } finally {
      hook.mockRestore()
      if (previous) Object.defineProperty(globalThis, 'location', previous)
      else Reflect.deleteProperty(globalThis, 'location')
    }
  }
)

test('failed provider entry offers explicit retry without requiring a provider choice', async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'location')
  Object.defineProperty(globalThis, 'location', { configurable: true, value: { search: '?authorization_id=expired' } })
  const hook = spyOn(hosted, 'useHostedConnect').mockReturnValue({
    state: { ...empty_hosted<HostedBotDescriptor>(), phase: 'failed' },
    dispatch: () => {},
    eligible: true,
  })
  try {
    const copy = await load_app_copy('en')
    const html = render_english(<AgentSetup copy={copy} close={() => {}} />)
    expect(html).not.toContain('agent-provider-card')
    expect(html).toContain('>Try again</button>')
    expect(html).not.toMatch(/<button[^>]*disabled[^>]*>Try again<\/button>/)
    expect(html).toContain('role="alert"')
    expect(html).not.toContain('Approve this bot and access')
  } finally {
    hook.mockRestore()
    if (previous) Object.defineProperty(globalThis, 'location', previous)
    else Reflect.deleteProperty(globalThis, 'location')
  }
})

test('invalid provider session shows a red restart instruction instead of a futile retry', async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'location')
  Object.defineProperty(globalThis, 'location', { configurable: true, value: { search: '?authorization_id=expired' } })
  const hook = spyOn(hosted, 'useHostedConnect').mockReturnValue({
    state: { ...empty_hosted<HostedBotDescriptor>(), phase: 'failed', failure: 'restart' },
    dispatch: () => {},
    eligible: true,
  })
  try {
    const copy = await load_app_copy('en')
    const html = render_english(<AgentSetup copy={copy} close={() => {}} />)
    expect(html).toContain('agent-connect-error')
    expect(html).toContain('Start the connection again in your assistant.')
    expect(html).not.toContain('>Try again</button>')
    expect(html).not.toContain('>Connect</button>')
    expect(html).toContain('>Cancel</button>')
  } finally {
    hook.mockRestore()
    if (previous) Object.defineProperty(globalThis, 'location', previous)
    else Reflect.deleteProperty(globalThis, 'location')
  }
})
