// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { ProviderHandoff } from '../../src/agents/ProviderHandoff.tsx'
import { load_app_copy } from '../../src/i18n/copy.ts'
import { LOCALES } from '../../src/i18n/locale.ts'

const url = 'https://service.example.test/mcp'
test.each(['ChatGPT', 'Claude', 'Grok'])(
  '%s handoff shows the real runtime URL without fake provider controls',
  async (provider) => {
    const copy = await load_app_copy('en')
    const html = renderToStaticMarkup(<ProviderHandoff copy={copy} provider={provider} url={url} />)
    expect(html).toContain(url)
    expect(html).toContain('Copy connection URL')
    expect(html).not.toMatch(/<(input|select|form)\b/)
    expect(html.match(/<button\b/g)).toHaveLength(1)
    expect(html).not.toContain('Agent connected')
    if (provider === 'ChatGPT') {
      expect(html).toContain('Add custom MCP server')
      expect(html).toContain('Create as a plugin')
      expect(html).toContain('OAuth')
      expect(html).toContain('Plugins')
    } else if (provider === 'Claude') {
      expect(html).toContain('Add custom connector')
      expect(html).toContain('MCP server URL')
      expect(html).not.toContain('Create as a plugin')
    } else {
      expect(html).toContain('grok.com/connectors')
      expect(html).not.toContain('data-provider-example')
    }
  }
)

test.each(LOCALES.map(({ code }) => code))('provider guide copy exists in %s', async (locale) => {
  const copy = await load_app_copy(locale)
  for (const provider of ['ChatGPT', 'Claude', 'Grok']) {
    const html = renderToStaticMarkup(<ProviderHandoff copy={copy} provider={provider} url={url} />)
    expect(html).not.toContain('agent_guide_')
    expect(html).not.toMatch(/\{provider\}/)
    expect(html).toContain(url)
  }
})
