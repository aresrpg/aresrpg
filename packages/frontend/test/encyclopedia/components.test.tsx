// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { EntityButton } from '../../src/encyclopedia/components.tsx'

test('entity rows render the level as a trailing badge', () => {
  const html = renderToStaticMarkup(
    <EntityButton active={false} badge="LV. 1" icon={null} meta="PET" name="Aetherwing" select={() => undefined} />
  )

  expect(html).toContain('Aetherwing')
  expect(html).toContain('PET')
  expect(html).toContain('LV. 1')
  expect(html).toContain('text-[#77d99a]')
})
