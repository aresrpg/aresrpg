import { expect, test } from '@playwright/test'

test('all 240 spells match the captured gameplay shader at each beat', async ({ page }) => {
  test.setTimeout(240_000)
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  await page.goto('/e2e/fixtures/spell_effects.html')
  await page.waitForFunction(() => window.spell_probe !== undefined)
  const results = await page.evaluate(async () => {
    const results = []
    for (const [classe, rows] of Object.entries(window.spell_probe.classes)) {
      for (const row of rows) {
        for (const time of [
          row.cast * 0.6,
          row.cast + row.fly * 0.7,
          row.cast + row.fly + (row.trap ? 1.7 : 0) + 0.2,
        ]) {
          results.push({ classe, name: row.name, time, ...(await window.spell_probe.fidelity(classe, row.name, time)) })
        }
      }
    }
    return results
  })
  expect(results).toHaveLength(720)
  // Native GPU compilers differ in transcendental precision, amplified by the authored sine hash.
  // Bound visible color error and its footprint; transparent RGB is not a visible difference.
  expect(
    results.filter((result) => result.composite_mean > 0.5 || result.composite_changed > 320 * 224 * 3 * 0.01)
  ).toEqual([])
  expect(errors).toEqual([])
})

test('all spells render in the game camera using real character models', async ({ page }) => {
  test.setTimeout(180_000)
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  await page.goto('/e2e/fixtures/spell_effects.html')
  await page.waitForFunction(() => window.spell_probe !== undefined)
  const spells = await page.evaluate(() =>
    Object.entries(window.spell_probe.classes).flatMap(([classe, rows]) =>
      rows.map((row) => ({ classe, name: row.name }))
    )
  )
  for (const [index, spell] of spells.entries()) {
    const cue = await page.evaluate(({ classe, name }) => window.spell_probe.choose(classe, name), spell)
    await page.evaluate((time) => window.spell_probe.sample(time), cue.effect!.timing!.impact_seconds + 0.2)
    if (index % 20 === 0)
      await test.info().attach(spell.classe, { body: await page.screenshot(), contentType: 'image/png' })
  }
  expect(errors).toEqual([])
})

test('all 145 recordings are served and decode', async ({ page }) => {
  await page.goto('/e2e/fixtures/spell_effects.html')
  await page.waitForFunction(() => window.spell_probe !== undefined)
  const decoded = await page.evaluate(async () => {
    const context = new OfflineAudioContext(1, 1, 44100)
    return Promise.all(
      window.spell_probe.sound_sources.map(async (url) => {
        const response = await fetch(url)
        if (!response.ok) throw new Error(`${response.status} ${url}`)
        const buffer = await context.decodeAudioData(await response.arrayBuffer())
        return buffer.duration > 0 && buffer.getChannelData(0).some((value) => Math.abs(value) > 0.001)
      })
    )
  })
  expect(decoded).toHaveLength(145)
  expect(decoded.every(Boolean)).toBe(true)
})

test('native compositing preserves scene pixels and orientation at rest', async ({ page }) => {
  await page.goto('/e2e/fixtures/spell_effects.html')
  await page.waitForFunction(() => window.spell_probe !== undefined)
  await page.evaluate(() => window.spell_probe.choose('yajin', 'Deviousness'))
  const result = await page.evaluate(() => window.spell_probe.roundtrip())
  expect(result.samples.map((sample) => sample.after)).toEqual(result.samples.map((sample) => sample.before))
  expect(result).toMatchObject({ changed: 0 })
  await page.evaluate(() => window.spell_probe.resize(800, 600))
  expect(await page.evaluate(() => window.spell_probe.roundtrip())).toMatchObject({ changed: 0 })
})

test('the transparent spell overlay preserves the authored composited colors', async ({ page }) => {
  await page.goto('/e2e/fixtures/spell_effects.html')
  await page.waitForFunction(() => window.spell_probe !== undefined)
  const result = await page.evaluate(() => window.spell_probe.overlay_parity())
  expect(result.overlay_maximum).not.toBeNull()
  expect(result.overlay_maximum!).toBeLessThanOrEqual(2)
})

test('the original Web Audio player schedules decoded recordings and synth layers', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.addInitScript(() => {
    const { start } = AudioBufferSourceNode.prototype
    Reflect.set(window, 'scheduled_spell_sounds', 0)
    AudioBufferSourceNode.prototype.start = new Proxy(start, {
      apply: (target, receiver, args) => {
        Reflect.set(window, 'scheduled_spell_sounds', Number(Reflect.get(window, 'scheduled_spell_sounds')) + 1)
        return Reflect.apply(target, receiver, args)
      },
    })
  })
  await page.goto('/e2e/fixtures/spell_effects.html')
  await page.waitForFunction(() => window.spell_probe !== undefined)
  await page.evaluate(async () => {
    await window.spell_probe.choose('yajin', 'Deviousness')
    await window.spell_probe.play_sound()
  })
  expect(await page.evaluate(() => Reflect.get(window, 'scheduled_spell_sounds'))).toBeGreaterThan(2)
  expect(errors).toEqual([])
})

test('all 24 character models render with matching GPU and CPU skinning', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  await page.goto('/e2e/fixtures/spell_effects.html')
  await page.waitForFunction(() => window.spell_probe !== undefined)
  const results = await page.evaluate(async () => {
    const outputs = []
    for (const [classe, rows] of Object.entries(window.spell_probe.classes))
      for (const male of [true, false]) {
        await window.spell_probe.choose(classe, rows[0]!.name, male)
        window.spell_probe.sample(0.5)
        // Three uploads skeleton poses once per animation frame, like gameplay.
        await new Promise(requestAnimationFrame)
        outputs.push({ classe, male, ...(await window.spell_probe.mask_parity()) })
      }
    return outputs
  })
  expect(errors).toEqual([])
  expect(results).toHaveLength(24)
  expect(results.filter((result) => result.filled === 0 || result.different > 8)).toEqual([])
})

test('successive casts keep separate audio tails and cancellation releases both buses', async ({ page }) => {
  await page.addInitScript(() => {
    Reflect.set(window, 'spell_bus_disconnects', 0)
    Reflect.set(window, 'spell_bus_fades', 0)
    for (const [prototype, key, counter] of [
      [GainNode.prototype, 'disconnect', 'spell_bus_disconnects'],
      [AudioParam.prototype, 'setTargetAtTime', 'spell_bus_fades'],
    ] as const) {
      const original = Reflect.get(prototype, key)
      Reflect.set(
        prototype,
        key,
        new Proxy(original, {
          apply: (target, receiver, args) => {
            Reflect.set(window, counter, Number(Reflect.get(window, counter)) + 1)
            return Reflect.apply(target, receiver, args)
          },
        })
      )
    }
  })
  await page.goto('/e2e/fixtures/spell_effects.html')
  await page.waitForFunction(() => window.spell_probe !== undefined)
  const counts = await page.evaluate(async () => {
    await window.spell_probe.choose('yajin', 'Deviousness')
    await window.spell_probe.play_sound()
    await window.spell_probe.play_sound()
    const fades = Reflect.get(window, 'spell_bus_fades')
    window.spell_probe.cancel_sound()
    return { fades, disconnected: Reflect.get(window, 'spell_bus_disconnects') }
  })
  expect(counts).toEqual({ fades: 0, disconnected: 2 })
})

test('all 24 profile pictures decode in the app and at their public Display URLs', async ({ page }) => {
  await page.goto('/e2e/fixtures/spell_effects.html')
  await page.waitForFunction(() => window.spell_probe !== undefined)
  const results = await page.evaluate(async () => {
    const sources = Object.keys(window.spell_probe.classes).flatMap((classe) =>
      ['male', 'female'].flatMap((sex) => [
        window.spell_probe.portrait_url(classe, sex),
        `/classe/${classe}_${sex}.jpg`,
      ])
    )
    return Promise.all(
      sources.map(async (url) => {
        if (!url) return { url, width: 0, height: 0 }
        const image = new Image()
        image.src = url
        await image.decode()
        return { url, width: image.naturalWidth, height: image.naturalHeight }
      })
    )
  })
  expect(results).toHaveLength(48)
  expect(results.every(({ width, height }) => width === 512 && height === 512)).toBe(true)
})

test('overlapping native spells preserve independent scene and mask bindings', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  await page.goto('/e2e/fixtures/spell_effects.html')
  await page.waitForFunction(() => window.spell_probe !== undefined)
  const result = await page.evaluate(() => window.spell_probe.overlap_parity())
  expect(errors).toEqual([])
  expect(result.changed).toBeGreaterThan(100)
  expect(result.maximum).toBeLessThanOrEqual(2)
})
