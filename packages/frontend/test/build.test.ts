// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Build-time gates: link previews, deployment pins and caching, the content security policy, the images the
// build emits, the environment and chain pins it bakes in, and the public guides it serves beside the site.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { expect, test } from 'bun:test'
import { loadImage } from '@napi-rs/canvas'
import { class_names } from '@aresrpg/immutable'
import { parse_client_packet } from '@aresrpg/protocol'
import ts from 'typescript'

import { browser_pins_plugin } from '../../../scripts/browser_pins.ts'
import { asset_inline_limit } from '../asset_inline.ts'
import {
  deployment_asset_url,
  deployment_build_config,
  pin_chunk_imports,
  validate_deployment_id,
} from '../deployment_assets.ts'
import { with_bot_csp } from '../deployment_csp.ts'
import { display_asset_bytes, display_asset_for_route, display_asset_rows } from '../display_assets.ts'
import { SOCIAL_CARD_HEIGHT, SOCIAL_CARD_WIDTH, create_card_painter, type EntityCard } from '../social_card_render.ts'
import { home_preview, social_catalog, social_html } from '../social_cards.ts'
import { is_gift_entry } from '../src/airdrop/gift_intent.ts'
import { docs_path, docs_view, is_docs_path } from '../src/docs/routes.ts'
import { resolve_env } from '../src/env.ts'
import { SITE_ADDRESSES, SITE_PAGES } from '../src/site/routes.ts'
import deployment from '../vercel.json' with { type: 'json' }

const frontend_dir = resolve(import.meta.dir, '..')
const repo_dir = resolve(frontend_dir, '../..')
const public_dir = resolve(frontend_dir, 'public')
const policy = deployment.headers
  .flatMap(({ headers }) => headers)
  .find(({ key }) => key === 'Content-Security-Policy')!.value
const connect_sources = (csp: string) =>
  csp
    .split(';')
    .find((directive) => directive.trim().startsWith('connect-src'))!
    .split(/\s+/u)
const app_rewrites = deployment.rewrites
  .filter(({ destination }) => destination === '/index.html')
  .map(({ source }) => new RegExp(`^${source}$`))

test('every shareable route has one preview card, and a page shell that lost a preview tag fails the build', async () => {
  const catalog = await social_catalog(
    {
      content_dir: resolve(repo_dir, 'seed/content'),
      copy_path: resolve(frontend_dir, 'src/i18n/locales/en.yaml'),
      icons_dir: resolve(repo_dir, 'seed/icons'),
    },
    'https://aresrpg.world/'
  )
  const routes = catalog.cards.map(({ route }) => route)
  expect(new Set(routes).size).toBe(routes.length)
  // Every card image is painted at build, once, and every painted image is some route's card.
  const painted = catalog.images.map(({ image }) => image)
  expect(new Set(painted).size).toBe(painted.length)
  expect(new Set(catalog.cards.map(({ image }) => image))).toEqual(new Set(painted))
  // Every page of the site has a card, and every card names an address the site serves: a page, the game's own
  // address, a standalone page, or a docs view that resolves to the very address it was read from.
  const served = (route: string): boolean => {
    const view = docs_view(route)
    const docs = view.kind === 'reference' ? docs_path(view.section, view.id, view.place) : docs_path(view.section)
    return (
      SITE_PAGES.some(({ path }) => path === route) ||
      route === SITE_ADDRESSES.world ||
      is_gift_entry(route, '#$key') ||
      (is_docs_path(route) && docs === route)
    )
  }
  expect(SITE_PAGES.map(({ path }) => path).filter((path) => !routes.includes(path))).toEqual([])
  expect(routes.filter((route) => !served(route))).toEqual([])
  for (const route of ['/world', '/docs', '/docs/items', '/gift', '/claim']) expect(routes).toContain(route)
  // Entity cards are the docs reference pages that resolve their object; every class shows its own portrait.
  const entities = catalog.cards.filter(({ route }) => route.split('/').length === 4)
  expect(entities.map(({ route }) => docs_view(route))).toEqual(
    entities.map(({ route }) => expect.objectContaining({ kind: 'reference', id: route.split('/').at(-1) }))
  )
  const class_cards = new Map(catalog.cards.map(({ route, image }) => [route, image]))
  expect(class_names.map((classe) => class_cards.get(`/docs/classes/${classe}`))).toEqual(
    class_names.map((classe) => `/social/classe/${classe}.jpg`)
  )
  // A route shell swaps every preview tag, escapes the title and leaves its own entry script alone.
  for (const shell of ['index.html', 'world.html'].map((document) =>
    readFileSync(resolve(frontend_dir, document), 'utf8')
  )) {
    const [entry] = shell.match(/<script type="module" src="[^"]+"><\/script>/)!
    const card = catalog.cards.find(({ route }) => route === '/docs/items/cloudstep_greaves')!
    const html = social_html(shell, { ...card, title: 'Tom & "Jerry"' }, 'https://preview.example/game/')
    expect(html).toContain('<title>Tom &amp; &quot;Jerry&quot; · AresRPG</title>')
    expect(html).toContain(
      '<meta property="og:image" content="https://preview.example/game/social/item/cloudstep_greaves.jpg" />'
    )
    expect(html).not.toContain('{{META_TITLE}}')
    expect(html).toContain(entry)
    expect(() =>
      social_html(shell.replace(/<meta name="twitter:image"[^>]*>/, ''), card, 'https://aresrpg.world/')
    ).toThrow('twitter:image')
    expect(shell).toContain(`<meta property="og:image:width" content="${SOCIAL_CARD_WIDTH}" />`)
  }
  // Cards are JPEGs of the declared size, and an entry of any name length or stat count still paints.
  const painter = await create_card_painter()
  const entry = catalog.images.find(({ card }) => card.kind === 'entity')!.card as EntityCard
  const crowded = { ...entry, name: 'Thread '.repeat(30), rows: Array(12).fill(['Agility', '1 – 100'] as const) }
  for (const card of [catalog.images[0]!.card, crowded]) {
    const bytes = await (await painter.paint(card)).encode('jpeg', 84)
    expect([...bytes.slice(0, 3)]).toEqual([0xff, 0xd8, 0xff])
    const image = await loadImage(Buffer.from(bytes))
    expect([image.width, image.height]).toEqual([SOCIAL_CARD_WIDTH, SOCIAL_CARD_HEIGHT])
  }
  // The root document's preview is the home's card, under the deployment's address, never rewritten to the shell.
  expect(home_preview('https://preview.example/game/').image_url).toBe(
    'https://preview.example/game/social/marketplace.jpg'
  )
  const home = new URL(home_preview('https://aresrpg.world/').image_url).pathname
  expect(painted).toContain(home)
  expect(
    [home, '/social/item/missing.jpg'].filter((preview) => app_rewrites.some((pattern) => pattern.test(preview)))
  ).toEqual([])
}, 30_000)

test('an open page keeps loading the assets of its own deployment, and only content-addressed files are immutable', async () => {
  const code = `import{a}from"./shared.js";const x=import("./lazy.js");const text='import("./example.js")';import "https://example.com/external.js";`
  const pinned = pin_chunk_imports(code, 'ares-123-1')
  expect(pinned).toContain('from"./shared.js?dpl=ares-123-1"')
  expect(pinned).toContain('import("./lazy.js?dpl=ares-123-1")')
  expect(pinned).toContain(`const text='import("./example.js")'`)
  expect(pinned).toContain('import "https://example.com/external.js"')
  expect(deployment_asset_url('ares-123-1', '/assets/file.js?x=1')).toBe('/assets/file.js?x=1&dpl=ares-123-1')
  for (const id of ['', 'dpl_reserved', '../bad', 'a'.repeat(33)]) expect(() => validate_deployment_id(id)).toThrow()
  const config = deployment_build_config({ ARES_DEPLOYMENT_ID: 'ares-123-1' })
  expect(
    (await config.precache_transforms[0]!([{ url: 'assets/app.js', revision: 'abc', size: 10 }])).manifest[0]
  ).toMatchObject({
    url: 'assets/app.js?dpl=ares-123-1',
    revision: 'abc',
  })
  expect(() => deployment_build_config({ VERCEL: '1' })).toThrow('ARES_DEPLOYMENT_ID')
  const cache_policy = (path: string) =>
    deployment.headers
      .filter(({ source }) => new RegExp(`^${source.replace(':path*', '(.*)')}$`).test(path))
      .flatMap(({ headers }) => headers)
      .find(({ key }) => key.toLowerCase() === 'cache-control')?.value ?? ''
  expect(cache_policy('/assets/index-abcdefgh.js')).toBe('public, max-age=31536000, immutable')
  for (const path of ['/', '/index.html', '/sw.js', '/item/sword.png', '/icons/items/sword.png'])
    expect(cache_policy(path)).not.toMatch(/immutable|max-age=[1-9]/)
  // Image routes, static pages and guides are never rewritten to a page shell; site pages are.
  for (const path of [
    '/item/cape_fuwa__white_hd.png',
    '/classe/yogan_male.jpg',
    '/icons/items/cape_fuwa__white.png',
    '/llms.txt',
    '/links',
    '/agents/missing.txt',
  ])
    expect(app_rewrites.some((pattern) => pattern.test(path))).toBe(false)
  for (const path of ['/', '/docs/items']) expect(app_rewrites.some((pattern) => pattern.test(path))).toBe(true)
  // Generated city artifacts stay files: the policy refuses data URLs, so an inlined artifact would fail to fetch.
  expect(connect_sources(policy)).not.toContain('data:')
  const generated = resolve(frontend_dir, '../engine/src/cities/generated')
  for (const file of readdirSync(generated).filter((name) => name.endsWith('.json')))
    expect(asset_inline_limit(resolve(generated, file))).toBe(false)
  expect(asset_inline_limit('/assets/models/pet.glb')).toBe(false)
})

test('the content security policy admits exactly the configured bot origin and fails closed without one', () => {
  const config = {
    version: 3,
    routes: [
      { src: '/(.*)', headers: { 'Content-Security-Policy': policy, 'X-Content-Type-Options': 'nosniff' } },
      { handle: 'filesystem' },
    ],
  } as const
  const result = with_bot_csp(config, 'https://bot.example.test/')
  const sources = connect_sources(result.routes[0]!.headers!['Content-Security-Policy'] as string)
  expect(sources).toContain('https://bot.example.test')
  for (const origin of ['*', 'https:', 'https://*', 'http://bot.example.test', 'https://unrelated.example'])
    expect(sources).not.toContain(origin)
  expect(config.routes[0].headers['Content-Security-Policy']).toBe(policy)
  expect(with_bot_csp(result, 'https://bot.example.test')).toEqual(result)
  expect(with_bot_csp(config, undefined)).toBe(config)
  for (const origin of [
    'http://bot.example.test',
    'https://user:secret@bot.example.test',
    'https://bot.example.test/path',
    'https://bot.example.test/?key=value',
  ])
    expect(() => with_bot_csp(config, origin)).toThrow()
  expect(() => with_bot_csp({ version: 3, routes: [] }, 'https://bot.example.test')).toThrow()
  expect(() =>
    with_bot_csp(
      { version: 3, routes: [{ headers: { 'content-security-policy': "default-src 'none'" } }] },
      'https://bot.example.test'
    )
  ).toThrow()
  expect(connect_sources(policy)).toContain('https://*.ingest.de.sentry.io')
  expect(connect_sources(policy)).not.toContain('*')
  expect(policy).toContain('https://api.slush.app')
})

test('every image the build emits resolves to one authored source, and portraits are derived, never stored', async () => {
  const rows = await display_asset_rows({ icons_dir: resolve(repo_dir, 'seed/icons') })
  const routes = new Set(rows.map(({ route }) => route))
  expect(routes.size).toBe(rows.length)
  expect(rows.every(({ source_path }) => existsSync(source_path))).toBe(true)
  for (const classe of class_names)
    for (const sex of ['male', 'female']) expect(routes.has(`/classe/${classe}_${sex}.jpg`)).toBe(true)
  expect(routes.has('/icons/items/solomonk.png')).toBe(true)
  expect(routes.has('/icons/items/solomonk_hd.png')).toBe(false)
  expect(readdirSync(resolve(repo_dir, 'seed/icons/characters')).filter((name) => /\.jpe?g$/iu.test(name))).toEqual([])
  const portraits = rows.filter(({ content_type }) => content_type === 'image/jpeg')
  expect(portraits).toHaveLength(24)
  const jpeg = await display_asset_bytes(portraits[0]!)
  expect([...jpeg.slice(0, 3)]).toEqual([255, 216, 255])
  // The development route finds art added after the server started.
  const directory = await mkdtemp(join(tmpdir(), 'aresrpg-display-assets-'))
  try {
    await Promise.all(
      ['items', 'mobs', 'spells', 'characters', 'nameplates'].map((family) => mkdir(join(directory, family)))
    )
    await writeFile(join(directory, 'items', 'new_item.png'), Buffer.from([1]))
    expect((await display_asset_for_route({ icons_dir: directory }, '/item/new_item_hd.png'))?.source_path).toBe(
      join(directory, 'items', 'new_item.png')
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('the build bakes complete public defaults and the chain pins of its own network only', async () => {
  const env = resolve_env({})
  expect(env).toMatchObject({
    app_url: 'https://aresrpg.world/',
    network: 'mainnet',
    server_ws_url: 'ws://localhost:9800/',
  })
  expect(() => resolve_env({ VITE_NETWORK: 'devnet' })).toThrow('Unsupported VITE_NETWORK: devnet')
  expect(() => resolve_env({ VITE_BOT_SERVICE_URL: 'http://bot.example' })).toThrow()
  // A testnet browser reads the local deployment pins and never falls back to mainnet's.
  const directory = await mkdtemp(join(tmpdir(), 'ares-browser-target-'))
  const previous = process.env.ARES_PINS_FILE
  delete process.env.ARES_PINS_FILE
  try {
    await mkdir(join(directory, 'scripts'))
    await mkdir(join(directory, '.dev'))
    await writeFile(
      join(directory, 'pins.json'),
      '{"network":"mainnet","package":"production","seed_ledger":{"current":"must-not-ship"}}'
    )
    await writeFile(join(directory, '.dev/pins.json'), '{"network":"testnet","package":"local"}')
    const plugin_path = join(directory, 'scripts/browser_pins.ts')
    await writeFile(plugin_path, await readFile(new URL('../../../scripts/browser_pins.ts', import.meta.url)))
    const { browser_pins_plugin: plugin } = (await import(pathToFileURL(plugin_path).href)) as {
      browser_pins_plugin: typeof browser_pins_plugin
    }
    const root = await realpath(join(directory, 'pins.json'))
    expect(JSON.parse((await plugin(undefined, 'testnet').load(root))!).package).toBe('local')
    const production = JSON.parse((await plugin(undefined, 'mainnet').load(root))!)
    expect(production.package).toBe('production')
    // Reconciliation metadata never ships in the browser's pins.
    expect(production.seed_ledger).toBeUndefined()
    await expect(plugin(root, 'testnet').load(root)).rejects.toThrow('do not match testnet')
    await rm(join(directory, '.dev/pins.json'))
    expect(() => plugin(undefined, 'testnet')).toThrow()
  } finally {
    if (previous === undefined) delete process.env.ARES_PINS_FILE
    else process.env.ARES_PINS_FILE = previous
    await rm(directory, { recursive: true, force: true })
  }
})

test('the public guides link only to what exists, their wire examples parse, and the Solana relay ships as plain JavaScript', () => {
  const guides = ['llms.txt', ...readdirSync(resolve(public_dir, 'agents')).map((file) => `agents/${file}`)]
  const roots = {
    'https://raw.githubusercontent.com/aresrpg/aresrpg/edge/': repo_dir,
    'https://aresrpg.world/': public_dir,
  }
  const addresses: readonly string[] = Object.values(SITE_ADDRESSES)
  const missing = guides
    .flatMap((path) =>
      [...readFileSync(resolve(public_dir, path), 'utf8').matchAll(/\]\((https:\/\/[^)]+)\)/g)].map(
        (match) => match[1]!
      )
    )
    .filter((link) => {
      const root = Object.entries(roots).find(([prefix]) => link.startsWith(prefix))
      if (!root || existsSync(resolve(root[1], link.slice(root[0].length)))) return false
      return !(root[1] === public_dir && addresses.includes(new URL(link).pathname))
    })
  expect(missing).toEqual([])
  const indexing = readFileSync(resolve(public_dir, 'agents/indexing.txt'), 'utf8')
  const examples = [...indexing.matchAll(/```json\s*([\s\S]*?)```/g)].map((match) => match[1]!)
  expect(examples.length).toBeGreaterThan(0)
  for (const example of examples) expect(parse_client_packet(example)).toEqual(JSON.parse(example))
  for (const path of ['llms.txt', 'agents/client.txt', 'agents/index.html']) {
    const guide = readFileSync(resolve(public_dir, path), 'utf8')
    expect(guide).toContain('work in progress')
    expect(guide).toContain('https://discord.gg/aresrpg')
  }
  // Vercel transpiles the relay's modules one by one: the emitted function must load in Node and refuse at once.
  const root = fileURLToPath(new URL('../', import.meta.url))
  const { options } = ts.parseJsonConfigFileContent(
    ts.readConfigFile(join(root, 'tsconfig.json'), ts.sys.readFile).config,
    ts.sys,
    root
  )
  const output = mkdtempSync(join(tmpdir(), 'aresrpg-solana-function-'))
  try {
    writeFileSync(join(output, 'package.json'), JSON.stringify({ type: 'module' }))
    for (const path of ['api/solana.ts', 'server/solana_rpc.ts', 'src/funding/solana_rpc_contract.ts']) {
      const destination = join(output, path.replace(/\.ts$/, '.js'))
      mkdirSync(dirname(destination), { recursive: true })
      writeFileSync(
        destination,
        ts.transpileModule(readFileSync(join(root, path), 'utf8'), { fileName: path, compilerOptions: options })
          .outputText
      )
    }
    const script = `import endpoint from './api/solana.js'
      const method = await endpoint.fetch(new Request('https://aresrpg.world/api/solana'))
      const origin = await endpoint.fetch(new Request('https://aresrpg.world/api/solana', { method: 'POST' }))
      console.log(JSON.stringify([method.status, origin.status]))`
    expect(
      JSON.parse(execFileSync('node', ['--input-type=module', '-e', script], { cwd: output, encoding: 'utf8' }))
    ).toEqual([405, 403])
  } finally {
    rmSync(output, { recursive: true, force: true })
  }
})
