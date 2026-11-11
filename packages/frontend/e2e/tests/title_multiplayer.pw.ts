// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { execFile as exec_file } from 'node:child_process'
import { mkdtemp, readFile as read_file, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { expect, test } from '@playwright/test'
import type { ServerPacket } from '@aresrpg/protocol'

test('independent clients render actual observer, late-join and reconnect socket packets', async ({ browser }) => {
  const directory = await mkdtemp(join(tmpdir(), 'ares-title-sockets-'))
  const capture = join(directory, 'packets.json')
  const first = await browser.newContext()
  const second = await browser.newContext()
  try {
    await promisify(exec_file)('bun', ['test', 'packages/server/test/title_multiplayer.test.ts'], {
      env: { ...process.env, TITLE_SOCKET_CAPTURE: capture },
    })
    const packets = JSON.parse(await read_file(capture, 'utf8')) as Record<string, ServerPacket[]>
    const observers = await Promise.all([first.newPage(), second.newPage()])
    for (const page of observers) {
      await page.goto('/e2e/fixtures/title_model.html')
      await expect.poll(() => page.evaluate(() => window.title_model_probe?.snapshot().frames ?? 0)).toBeGreaterThan(2)
    }
    // These are captured real WebSocket messages replayed into separate browser realms.
    // Persistence/pubsub/auth remain fixtures; packet reduction and GLB rendering are production code.
    for (const [index, phase] of ['equipped', 'late', 'reconnected'].entries()) {
      const page = observers[index % 2]!
      const result = await page.evaluate((rows) => window.title_model_probe.from_packets(rows), packets[phase]!)
      expect(result.title).toBe('title_veteran')
      expect(result.appearance.body_url).toContain('blast_girl')
      expect(result.appearance.worn.head?.url).toContain('solomonk')
      expect(result.appearance.worn.back?.url).toContain('cape_fuwa')
      expect(await page.evaluate(() => window.title_model_probe.snapshot())).toMatchObject({
        head_parts: 1,
        cape_parts: 1,
      })
      await expect.poll(() => page.evaluate(() => window.title_model_probe.snapshot().crowd.instances)).toBe(1)
      await page.screenshot({ path: `test-results/title-socket-${phase}.png` })
    }
    for (const page of observers) {
      const result = await page.evaluate((rows) => window.title_model_probe.from_packets(rows), packets.unequipped!)
      expect(result.title).toBeNull()
      expect(result.appearance.body_url).toContain('senshi_male')
    }
  } finally {
    await first.close()
    await second.close()
    await rm(directory, { recursive: true, force: true })
  }
})

test('native Blast Girl supports every available equipment item and playable clip', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (['error', 'warning'].includes(message.type())) errors.push(message.text())
  })
  await page.goto('/e2e/fixtures/title_model.html')
  await expect.poll(() => page.evaluate(() => window.title_model_probe?.snapshot().frames ?? 0)).toBeGreaterThan(2)
  await page.evaluate(() => window.title_model_probe.equip(true, '', ''))
  expect(await page.evaluate(() => window.title_model_probe.snapshot().hair_visible)).toBe(true)
  await page.screenshot({ path: 'test-results/blast-girl-native-bare.png' })
  const equipment = await page.evaluate(() => window.title_model_probe.equipment)
  expect(equipment.length).toBeGreaterThan(0)
  for (const item of equipment) {
    const hat = item.category.endsWith('hat')
    await page.evaluate(
      ({ item_type, hat }) => window.title_model_probe.equip(true, hat ? item_type : '', hat ? '' : item_type),
      { item_type: item.item_type, hat }
    )
    expect(await page.evaluate(() => window.title_model_probe.snapshot())).toMatchObject({
      head_parts: hat ? 1 : 0,
      hair_visible: !hat,
      cape_parts: hat ? 0 : 1,
    })
    await expect.poll(() => page.evaluate(() => window.title_model_probe.snapshot().crowd.instances)).toBe(1)
    await page.screenshot({ path: `test-results/blast-equipment-${item.item_type}.png` })
  }
  await page.evaluate(() => window.title_model_probe.equip(true))
  const clips = await page.evaluate(() => window.title_model_probe.snapshot().clips)
  expect(clips).toHaveLength(12)
  expect(clips.find(({ name }) => name === 'DEATH')?.duration).toBe(1)
  for (const { name } of clips) {
    await page.evaluate((clip) => window.title_model_probe.animate(clip), name)
    await page.waitForTimeout(150)
    await page.screenshot({ path: `test-results/blast-animation-${name}.png` })
  }
  expect(errors).toEqual([])
})

test('all registered community titles render their native body, equipment and mounted pose', async ({ page }) => {
  await page.goto('/e2e/fixtures/title_model.html')
  await expect.poll(() => page.evaluate(() => window.title_model_probe?.snapshot().frames ?? 0)).toBeGreaterThan(2)
  const titles = await page.evaluate(() => window.title_model_probe.community_titles)
  expect(titles).toHaveLength(10)
  for (const { item_type, title_model } of titles) {
    await page.evaluate((title) => window.title_model_probe.community_title(title), item_type)
    const state = await page.evaluate(() => window.title_model_probe.snapshot())
    expect(state.body_url).toContain(title_model!)
    expect(state.head_parts).toBe(1)
    expect(state.cape_parts).toBe(1)
    expect(state.hair_visible).toBe(false)
    expect(state.rider).toBe(true)
    expect(state.clips.find(({ name }) => name === 'DEATH')?.duration).toBe(1)
    await expect.poll(() => page.evaluate(() => window.title_model_probe.snapshot().crowd.instances)).toBe(1)
    await page.screenshot({ path: `test-results/community-${item_type}.png` })
    await page.evaluate(() => window.title_model_probe.mount())
    await expect
      .poll(() => page.evaluate(() => window.title_model_probe.snapshot().mounted_distance))
      .toBeLessThan(0.001)
  }
})
