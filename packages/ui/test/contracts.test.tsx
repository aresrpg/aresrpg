// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { Button, CombatHud, Toggle } from '../src/index.ts'

test('pending actions cannot be submitted again', () => {
  const markup = renderToStaticMarkup(<Button busy>Confirm</Button>)
  expect(markup).toContain('disabled=""')
  expect(markup).toContain('aria-busy="true"')
  expect(markup).toContain('type="button"')
})

test('toggles retain native keyboard and touch semantics', () => {
  const markup = renderToStaticMarkup(
    <>
      <Toggle label="Music" checked={true} on_change={() => undefined} />
    </>
  )
  expect(markup).toContain('type="checkbox"')
  expect(markup).toContain('role="switch"')
  expect(markup).toContain('checked=""')
})

test('combat clock handles expired data without negative progress or a second timer', () => {
  const markup = renderToStaticMarkup(
    <CombatHud
      label="Combat"
      vitals="HP"
      spells="Spells"
      controls={<Button disabled>End turn</Button>}
      timer={{ label: 'Time left', remaining: -5, duration: 0 }}
    />
  )
  expect(markup).toContain('value="0"')
  expect(markup).toContain('max="1"')
  expect(markup).not.toContain('-5')
})
