// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { AgentKioskPanel } from '../../src/agents/AgentKioskPanel.tsx'
import type { AgentKioskController } from '../../src/agents/useAgentKiosk.ts'
import type { AppCopy } from '../../src/i18n/copy.ts'

const copy = {
  ui: {
    agent_asset_refresh: 'Refresh',
    agent_kiosk: 'Agent kiosk',
    agent_inventory_demo: 'Offline transfers unavailable',
  },
  loading_universe: 'Loading',
} as unknown as AppCopy
const controller = (phase: 'failed' | 'loading') =>
  ({
    pairing: { address: 'agent' },
    state: { phase, error: 'RPC unavailable' },
    transaction: { phase: 'idle' },
    pending_ids: new Set(),
    agent_pending: [],
    refresh: () => {
      throw new Error('Rendering must not load')
    },
  }) as unknown as AgentKioskController

test('an initial inventory read failure keeps refresh available without a snapshot', () => {
  const html = renderToStaticMarkup(
    <AgentKioskPanel kiosk={controller('failed')} copy={copy} disabled={false} offline={false} />
  )
  expect(html).toContain('RPC unavailable')
  expect(html).toContain('aria-label="Refresh"')
  expect(html).not.toContain('disabled=""')
})
test('loading and offline panels cannot start another discovery or pretend transfers exist', () => {
  const loading = renderToStaticMarkup(
    <AgentKioskPanel kiosk={controller('loading')} copy={copy} disabled={false} offline={false} />
  )
  expect(loading).toContain('disabled=""')
  const offline = renderToStaticMarkup(
    <AgentKioskPanel kiosk={controller('failed')} copy={copy} disabled={false} offline />
  )
  expect(offline).toContain('Offline transfers unavailable')
  expect(offline).toContain('disabled=""')
  expect(offline).not.toContain('RPC unavailable')
})

test('a failed refresh retains display data but disables transfers until discovery succeeds', () => {
  const kiosk = {
    ...controller('failed'),
    snapshot: { inventory: { items: [], sui_mist: '1000000000', kares_mist: null } },
  } as unknown as AgentKioskController
  const html = renderToStaticMarkup(<AgentKioskPanel kiosk={kiosk} copy={copy} disabled={false} offline={false} />)
  expect(html).toMatch(/<button[^>]*aria-label="SUI"[^>]*disabled=""/)
  expect(html).not.toMatch(/<button[^>]*aria-label="Refresh"[^>]*disabled/)
  expect(html).toContain('RPC unavailable')
})

test('inventory uses compact filters and official coin marks without the rejected review surface', () => {
  const kiosk = {
    ...controller('failed'),
    snapshot: { inventory: { items: [], sui_mist: '1', kares_mist: null } },
  } as unknown as AgentKioskController
  const html = renderToStaticMarkup(<AgentKioskPanel kiosk={kiosk} copy={copy} disabled={false} offline={false} />)
  expect(html).toContain('agent-kiosk__categories')
  expect(html).toContain('data-sui-logo')
  expect(html).toContain('agent-sui-mark')
  expect(html).not.toContain('chr-bagtab')
  expect(html).not.toContain('Transfer review')
  expect(html).not.toContain('Check transaction')
})

test('agent SUI display truncates to two decimal digits without changing the stored amount', () => {
  const inventory = { items: [], sui_mist: '1234567890', kares_mist: null }
  const kiosk = { ...controller('failed'), snapshot: { inventory } } as unknown as AgentKioskController
  const html = renderToStaticMarkup(<AgentKioskPanel kiosk={kiosk} copy={copy} disabled={false} offline={false} />)
  expect(html).toContain('<b>1.23</b>')
  expect(inventory.sui_mist).toBe('1234567890')
})
