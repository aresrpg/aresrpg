// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { DocsPage, type DocsLinks } from '../../src/docs/DocsPage.tsx'
import { DOCS_GUIDES, DOCS_ORDER, docs_path } from '../../src/docs/routes.ts'
import { load_app_copy, type AppCopy } from '../../src/i18n/copy.ts'
import { LOCALES } from '../../src/i18n/locale.ts'

const links: DocsLinks = {
  source: 'https://source.test',
  playbook: 'https://app.test/agents',
  agent_guide: 'https://app.test/agents/client.txt',
  license: 'https://license.test',
  home: 'https://app.test/',
  play: 'https://app.test/world',
}
const render = (copy: AppCopy, pathname: string): string =>
  renderToStaticMarkup(<DocsPage copy={copy} links={links} navigate={() => undefined} pathname={pathname} />)

for (const { code } of LOCALES)
  test(`every guide renders complete copy and real object links in ${code}`, async () => {
    const copy = await load_app_copy(code)
    for (const guide of DOCS_GUIDES) {
      const html = render(copy, docs_path(guide))
      expect(html).not.toContain('undefined')
      expect(html).not.toContain('{{')
      expect(html.match(/aria-current="page"/g)).toHaveLength(1)
      for (const section of DOCS_ORDER) expect(html).toContain(`href="${docs_path(section)}"`)
    }
    const first_hour = render(copy, docs_path('first-hour'))
    expect(first_hour).toMatch(/href="\/docs\/items\/[a-z_]+"/)
    expect(first_hour).toMatch(/href="\/docs\/bestiary\/[a-z_]+"/)
  })

test('an unknown docs location shows the overview, not an empty page', async () => {
  const copy = await load_app_copy('en')
  expect(render(copy, '/docs/not-a-page')).toContain(`<h1>${copy.docs_page.guides.overview}</h1>`)
})
