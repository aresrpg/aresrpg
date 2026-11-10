// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import type { HostedBotDescriptor } from '@aresrpg/protocol'

import { HostedBotPanel } from '../../src/agents/HostedBotPanel.tsx'
import { empty_hosted } from '../../src/agents/hosted_state.ts'
import { load_app_copy } from '../../src/i18n/copy.ts'

const bot: HostedBotDescriptor = {
  id: 'bot',
  address: 'private-bot-address',
  multisig_public_key: 'descriptor',
  generation: 1,
  policy_revision: 1,
  status: 'ready',
}
test.each(['bot:play', 'bot:observe', 'bot:pause'])(
  'consent for %s is concise, destination-bound, and never grants on render',
  async (scope) => {
    const copy = await load_app_copy('en')
    const state = {
      ...empty_hosted<HostedBotDescriptor>(),
      phase: 'ready' as const,
      bots: [bot],
      selected: bot.id,
      verified: bot.id,
      consent: {
        authorization_id: 'request',
        client_id: 'opaque-client-id',
        client_name: 'Spoofed ChatGPT Brand',
        redirect_uri: 'https://receiver.example/callback?private=value',
        resource: 'https://service.example/mcp',
        network: 'mainnet' as const,
        scopes: [scope],
      },
    }
    const dispatched: unknown[] = []
    const html = renderToStaticMarkup(
      <HostedBotPanel
        copy={copy}
        state={state}
        dispatch={(input) => {
          dispatched.push(input)
        }}
      />
    )
    expect(html).toContain('receiver.example')
    expect(html).toContain('>Connect</button>')
    for (const hidden of [
      'Setup complete',
      'Spoofed ChatGPT Brand',
      'opaque-client-id',
      '/callback',
      'private=value',
      'https://service.example/mcp',
      'mainnet',
      'Policy revision',
      'bot:play',
      'bot:observe',
      'bot:pause',
    ])
      expect(html).not.toContain(hidden)
    expect(dispatched).toEqual([])
    if (scope === 'bot:play') expect(html).toContain('spend')
    else expect(html).not.toContain('spend')
  }
)
