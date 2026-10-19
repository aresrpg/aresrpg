// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { cpus, totalmem } from 'node:os'

import { expect, test } from '@playwright/test'

import { install_probe } from '../support/browser_probe.ts'

test('demo fight spell cold and warm frame costs', async ({ page, browser }, info) => {
  test.setTimeout(180000)
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  await page.addInitScript(install_probe)
  await page.addInitScript(() => {
    let calls: Record<string, { count: number; ms: number; max: number }> = {}
    let spell_pipelines: string[] = []
    let submission_counts: Record<number, number> = {}
    let stalls: { call: string; ms: number }[] = []
    const wrap = (prototype: object, key: string, label: string) => {
      const original = Reflect.get(prototype, key)
      Reflect.set(
        prototype,
        key,
        new Proxy(original, {
          apply: (target, receiver, args) => {
            if (label === 'gpu.submit')
              submission_counts[window.workload_frame_count] = (submission_counts[window.workload_frame_count] ?? 0) + 1
            if (
              label.startsWith('gpu.createRenderPipeline') &&
              String(args[0]?.label).includes('renderPipeline_spell_')
            )
              spell_pipelines.push(String(args[0].label))
            const start = performance.now()
            const result = Reflect.apply(target, receiver, args)
            const elapsed = performance.now() - start
            if (elapsed > 50) stalls.push({ call: label, ms: elapsed })
            const row = (calls[label] ??= { count: 0, ms: 0, max: 0 })
            row.count += 1
            row.ms += elapsed
            row.max = Math.max(row.max, elapsed)
            return result
          },
        })
      )
    }
    for (const method of ['submit', 'copyExternalImageToTexture', 'writeBuffer', 'writeTexture'])
      wrap(GPUQueue.prototype, method, `gpu.${method}`)
    for (const method of ['createRenderPipeline', 'createRenderPipelineAsync'])
      wrap(GPUDevice.prototype, method, `gpu.${method}`)
    Reflect.set(window, 'spell_measure', async (action: () => void | Promise<void>, milliseconds: number) => {
      calls = {}
      spell_pipelines = []
      submission_counts = {}
      stalls = []
      const frames: number[] = []
      let previous = performance.now()
      window.workload_on_frame = (now) => {
        frames.push(now - previous)
        previous = now
      }
      const start = performance.now()
      await Promise.all([action(), new Promise((resolve) => setTimeout(resolve, milliseconds))])
      await window.workload_gpu_done?.()
      window.workload_on_frame = undefined
      const sorted = [...frames].sort((a, b) => a - b)
      return {
        max_gpu_submissions: Math.max(0, ...Object.values(submission_counts)),
        duration: performance.now() - start,
        frames: frames.length,
        fps: (frames.length * 1000) / (performance.now() - start),
        p50: sorted[Math.floor(sorted.length * 0.5)],
        p95: sorted[Math.floor(sorted.length * 0.95)],
        max: Math.max(...frames),
        over50: frames.filter((value) => value > 50).length,
        calls,
        spell_pipelines,
        stalls,
      }
    })
  })
  const cdp = await page.context().newCDPSession(page)
  const cpu_rate = Number(process.env.PERF_CPU_RATE ?? 1)
  const quality = process.env.PERF_QUALITY ?? 'high'
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpu_rate })
  await cdp.send('Profiler.enable')
  await cdp.send('Profiler.start')
  await page.goto(`/e2e/fixtures/fight_spells.html?quality=${quality}`)
  await page.waitForFunction(() => Reflect.has(window, 'demo_spell_probe') && window.workload_frame_count > 30, null, {
    timeout: 60000,
  })
  await expect(page.locator('[data-world-loading]:visible')).toHaveCount(0, { timeout: 60000 })
  const entry = await page.evaluate(() =>
    Reflect.get(window, 'spell_measure')(() => Reflect.get(window, 'demo_spell_probe').open('yajin'), 3000)
  )
  const idle = await page.evaluate(() => Reflect.get(window, 'spell_measure')(() => {}, 3000))
  const cold = await page.evaluate(() =>
    Reflect.get(window, 'spell_measure')(() => Reflect.get(window, 'demo_spell_probe').cast('Deviousness'), 6500)
  )
  await page.evaluate(() => Reflect.get(window, 'demo_spell_probe').settled())
  console.log('cold', JSON.stringify({ idle, cold }))
  await page.evaluate(() => Reflect.get(window, 'demo_spell_probe').next_turn())
  const warm = await page.evaluate(() =>
    Reflect.get(window, 'spell_measure')(() => Reflect.get(window, 'demo_spell_probe').cast('Deviousness'), 6500)
  )
  await page.evaluate(() => Reflect.get(window, 'demo_spell_probe').open('yajin', true))
  const followup = await page.evaluate(async () => {
    const probe = Reflect.get(window, 'demo_spell_probe')
    let recovery_ms = 0
    const measured = await Reflect.get(window, 'spell_measure')(() => {
      const started = performance.now()
      probe.cast('Deviousness')
      let locked = false
      const next = () => {
        const button = document.querySelector<HTMLButtonElement>('button[aria-label^="Deviousness"]')
        if (button?.disabled) locked = true
        if (locked && button && !button.disabled) {
          recovery_ms = performance.now() - started
          probe.cast('Deviousness')
        } else requestAnimationFrame(next)
      }
      requestAnimationFrame(next)
    }, 6500)
    return { ...measured, recovery_ms }
  })
  await page.evaluate(() => Reflect.get(window, 'demo_spell_probe').open('yajin', true))
  const sequence = await page.evaluate(() =>
    Reflect.get(window, 'spell_measure')(() => {
      const probe = Reflect.get(window, 'demo_spell_probe')
      return (async () => {
        for (let index = 0; index < 4; index += 1) {
          if (index === 2) await probe.next_turn()
          probe.cast('Deviousness')
          await probe.settled()
        }
      })()
    }, 8000)
  )
  const heavy = []
  for (const [classe, spell] of process.env.PERF_HEAVY === '0'
    ? []
    : [
        ['yogan', 'Explosive Arrow'],
        ['yajin', 'Lethal Attack'],
        ['senshi', "Senshi's Wrath"],
        ['tomoda', 'Primal Cataclysm'],
        ['tokei', 'Temporal Dial'],
        ['rojin', 'Slaughtering Shovel'],
        ['shugo', 'Cloudy Attack'],
        ['iyashi', 'Forbidden Word'],
        ['ikari', 'Blood Blade'],
        ['shusen', 'Pandatak'],
        ['asobi', 'Rekop'],
        ['mori', 'Aggressive Brambles'],
      ]) {
    await page.evaluate(({ classe, spell }) => Reflect.get(window, 'demo_spell_probe').open(classe, false, spell), {
      classe,
      spell,
    })
    await page.waitForTimeout(1000)
    const sample = await page.evaluate(
      (spell) => Reflect.get(window, 'spell_measure')(() => Reflect.get(window, 'demo_spell_probe').cast(spell), 6500),
      spell
    )
    heavy.push({ classe, spell, ...sample })
  }
  const { profile } = await cdp.send('Profiler.stop')
  const adapter = await page.evaluate(() => window.workload_adapter)
  const state = await page.evaluate(() => Reflect.get(window, 'demo_spell_probe').state())
  const result = {
    cpu: cpus()[0]?.model,
    cpu_rate,
    quality,
    canvas_size: await page.evaluate(() => {
      const canvas = [...document.querySelectorAll('canvas')].sort(
        (left, right) => right.width * right.height - left.width * left.height
      )[0]!
      return [canvas.width, canvas.height]
    }),
    memory: totalmem(),
    browser: browser.version(),
    adapter,
    viewport: page.viewportSize(),
    entry,
    idle,
    cold,
    warm,
    followup,
    sequence,
    heavy,
    state,
  }
  console.log(JSON.stringify(result))
  await info.attach('spell-performance', { contentType: 'application/json', body: JSON.stringify(result, null, 2) })
  await info.attach('spell-cpu-profile', { contentType: 'application/json', body: JSON.stringify(profile) })
  await info.attach('demo-fight', { contentType: 'image/png', body: await page.screenshot() })
  expect(adapter?.fallback).toBe(false)
  expect(JSON.stringify(adapter)).not.toMatch(/swiftshader|llvmpipe|software/i)
  expect(cold.spell_pipelines).toEqual([])
  expect(warm.spell_pipelines).toEqual([])
  expect(followup.spell_pipelines).toEqual([])
  expect(sequence.spell_pipelines).toEqual([])
  expect(entry.max, 'fight entry must not perform multi-second cold preparation').toBeLessThan(500)
  expect(cold.max, 'the first spell must use a warmed render path').toBeLessThan(100)
  expect(warm.max, 'actor rendering must not stall a later turn').toBeLessThan(200)
  expect(followup.max, 'a following spell must not trigger deferred driver work').toBeLessThan(100)
  expect(sequence.max, 'repeated spells must keep a bounded frame cost').toBeLessThan(200)
  expect(sequence.p95, 'overlapping spells must keep a bounded frame cost').toBeLessThan(50)
  expect(errors).toEqual([])
})
