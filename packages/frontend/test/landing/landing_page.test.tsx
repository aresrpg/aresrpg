// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { load_app_copy } from '../../src/i18n/copy.ts'
import { LOCALES } from '../../src/i18n/locale.ts'
import { LandingPage } from '../../src/landing/LandingPage.tsx'
import { INTERFACE_IDS, type LandingCopy } from '../../src/landing/landing_types.ts'
import { create_landing_assets, landing_links } from '../../src/landing/presentation.ts'

const AGENT_URL = 'https://app.test/world?intent=connect-agent'
const assets = create_landing_assets({
  portrait: 'portrait.png',
  item_key: 'key.png',
  item_horn: 'horn.png',
  item_bow: 'bow.png',
  podium: ['first.png', 'second.png', 'third.png'],
})
const links = landing_links('https://app.test', 'https://discord.test/invite')

const render = (copy: LandingCopy): string =>
  renderToStaticMarkup(
    <LandingPage agent_connect_url={AGENT_URL} assets={assets} copy={copy} links={links} on_play={() => undefined} />
  )

for (const { code } of LOCALES)
  test(`the build-time home page renders every interface and section in ${code}`, async () => {
    const copy = await load_app_copy(code)
    const html = render(copy.landing_page)
    expect(html).not.toContain('undefined')
    expect(html.match(/role="radio"/g)).toHaveLength(INTERFACE_IDS.length)
    for (const id of INTERFACE_IDS) expect(html).toContain(`data-if="${id}"`)
    expect(html.match(/class="pay rim"/g)).toHaveLength(3)
    expect(html.match(/class="mode rim"/g)).toHaveLength(2)
  })

test('the hero plays the 3D game or opens the dapp, and the voxel world is the first selection', async () => {
  const copy = await load_app_copy('en')
  const html = render(copy.landing_page)
  expect(html).toMatch(/<button class="aui-button cta" data-hue="green"[^>]*>.*?Play in 3D<\/button>/s)
  expect(html).toMatch(
    /<a class="aui-button cta" data-hue="gold" href="https:\/\/app\.test\/dapp">.*?Play with bots<\/a>/s
  )
  expect(html).toContain('data-active="world"')
  // The header and the item links open the standalone docs, which need no sign-in.
  expect(html).toContain('<a href="https://app.test/docs">Docs</a>')
  expect(html.match(/href="https:\/\/app\.test\/docs\/items"/g)).toHaveLength(2)
  expect(html).not.toContain('/encyclopedia')
  expect(html).toMatch(/aria-checked="true"[^>]*data-if="world"/)
  // The closing reminder appears only for a selection other than the default.
  expect(html).not.toContain('class="pick"')
})

test('the web dapp card opens the dapp route of this app', () => {
  expect(links.dapp).toBe('https://app.test/dapp')
})
