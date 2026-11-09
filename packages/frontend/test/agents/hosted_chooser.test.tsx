// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

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
