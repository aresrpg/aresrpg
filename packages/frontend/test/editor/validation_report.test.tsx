// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { ValidationCounters, ValidationPanel } from '../../src/editor/ValidationReport.tsx'

const report = Object.freeze({
  reds: Object.freeze(['RED  R-UNOBTAINABLE — mossbound_eggshell']),
  warns: Object.freeze(['WARN R-FUNNEL-SOURCE — golden_wheat']),
})

test('validation counters are buttons that disclose their exact rows', () => {
  const counters = renderToStaticMarkup(<ValidationCounters active="reds" report={report} select={() => undefined} />)
  const panel = renderToStaticMarkup(<ValidationPanel active="reds" error={null} report={report} />)

  expect(counters).toContain('data-validation-toggle="reds"')
  expect(counters).toContain('aria-expanded="true"')
  expect(counters).toContain('1 red')
  expect(counters).toContain('1 warn')
  expect(panel).toContain('data-validation-panel="reds"')
  expect(panel).toContain('mossbound_eggshell')
  expect(panel).not.toContain('golden_wheat')
})

test('a transport error takes precedence over the selected validation list', () => {
  const panel = renderToStaticMarkup(<ValidationPanel active="warns" error="Save failed" report={report} />)

  expect(panel).toContain('Save failed')
  expect(panel).not.toContain('golden_wheat')
})
