// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from '@playwright/test'

import { make_ui_verb_driver } from '../bot/ui_driver.mjs'

test('UI VERB DRIVER · physical click/type/drag produce digest + DOM checkpoints', async ({ page }) => {
  await page.setContent(`
    <title>AresRPG verb fixture</title>
    <button id="list" onclick="document.body.dataset.digest='list-digest'; document.querySelector('#status').textContent='listed'">List</button>
    <input id="price" oninput="document.body.dataset.digest='type-digest'; document.querySelector('#status').textContent=this.value" />
    <div id="from" style="position:absolute;left:10px;top:80px;width:30px;height:30px;background:red"></div>
    <div id="to" style="position:absolute;left:100px;top:80px;width:30px;height:30px;background:blue"></div>
    <output id="status">idle</output>
  `)
  const checkpoints: any[] = []
  const driver = make_ui_verb_driver({
    page,
    read_digest: async () => page.locator('body').getAttribute('data-digest'),
    read_dom: async () => ({
      url: page.url(),
      title: await page.title(),
      snapshot: await page.locator('#status').innerText(),
    }),
    checkpoint: (row: any) => checkpoints.push(row),
  })
  const rows = await driver.run([
    { click: '#list' },
    { type: { locator: '#price', value: '100000000' } },
    { drag: { from: '#from', to: '#to' } },
  ])
  expect(rows.map((row: any) => row.verb)).toEqual(['click', 'type', 'drag'])
  expect(rows[0].digest).toBe('list-digest')
  expect(rows[1].digest).toBe('type-digest')
  expect(rows[1].dom.snapshot).toBe('100000000')
  expect(checkpoints).toHaveLength(3)
})
