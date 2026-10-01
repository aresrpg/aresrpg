// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, spyOn, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { MountPrompt } from '../../src/components/MountPrompt.tsx'
import * as mount_feed from '../../src/game/core/mount_prompt_feed.ts'
import { load_app_copy } from '../../src/i18n/copy.ts'
import { LOCALES } from '../../src/i18n/locale.ts'

test('mount and dismount prompts render translated keyboard and touch labels in every locale', async () => {
  const prompt = spyOn(mount_feed, 'useMountPrompt')
  try {
    for (const { code: locale } of LOCALES) {
      const copy = await load_app_copy(locale)
      for (const riding of [false, true]) {
        prompt.mockReturnValue({ root: { nodeType: 1 } as HTMLElement, riding, activate: () => {} })
        const portal = MountPrompt({ copy })
        expect(portal).not.toBeNull()
        const html = renderToStaticMarkup(portal!.children)
        expect(html).not.toContain('undefined')
        expect(html).toContain('<kbd')
        expect(html).toContain('>X</kbd>')
      }
    }
  } finally {
    prompt.mockRestore()
  }
})
