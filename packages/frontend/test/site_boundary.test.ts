// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The site loads no game code: its store modules, its entry and each of its pages reach neither the engine, the
// game's own code, Three.js, the sign-in actions, a content table the site does not read nor an eager import of a
// folder of art. A type import loads nothing and a dynamic import loads on demand, so the walk follows static
// value imports and re-exports only.
import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'

import { expect, test } from 'bun:test'

const REPOSITORY = resolve(import.meta.dir, '../../..')
const FRONTEND = resolve(REPOSITORY, 'packages/frontend')

/** Where the site starts: the modules of its store, the entry that renders its shell, and each page it loads. */
const SITE_ROOTS = [
  'src/site_modules.ts',
  'src/site/entry.tsx',
  'src/marketplace/MarketPage.tsx',
  'src/leaderboards/LeaderboardsPage.tsx',
  'src/kares/StakingPage.tsx',
  'src/portfolio/PortfolioPage.tsx',
  'src/agents/AgentPage.tsx',
  'src/admin/AdminPage.tsx',
].map((path) => resolve(FRONTEND, path))

/** The content tables the site reads, each for one reason. */
const SITE_TABLES = new Set([
  // Item names and artwork in the market, the gift notice and the giftcard claims.
  'seed/content/items.json',
  // Whether a resource is crafted: the bag filters of the portfolio.
  'seed/content/recipes.json',
  // The staking page's Mastery shop offers and its airdrop campaigns.
  'seed/content/mastery.json',
  'seed/content/airdrop.json',
])

/** The protocol shares the fight's wire and contract with the server: the site meets the fight only there. */
const FIGHT_DOORS = new Set(['packages/protocol/src/packets.ts', 'packages/protocol/src/character_stats.ts'])

const FORBIDDEN = [
  { reason: 'the engine', matches: (path: string) => path.startsWith('packages/engine/') },
  { reason: 'the mobile game', matches: (path: string) => path.startsWith('packages/frontend/src/mobile/') },
  { reason: "the game's own code", matches: (path: string) => path.startsWith('packages/frontend/src/game/') },
  { reason: "a module of the game's list alone", matches: (path: string) => GAME_ONLY_MODULES.has(path) },
  { reason: 'the sign-in actions', matches: (path: string) => path === 'packages/sdk/src/auth.ts' },
  {
    reason: 'the full item sheet, whose sources read every content table (a site page shows `ItemSummary`)',
    matches: (path: string) => path === 'packages/frontend/src/components/ItemDetailView.tsx',
  },
  {
    reason: 'the gameplay catalogue, which loads every content table',
    matches: (path: string) => path === 'packages/frontend/src/content/catalog.ts',
  },
  {
    reason: 'a content table the site does not read',
    matches: (path: string) => path.startsWith('seed/content/') && !SITE_TABLES.has(path),
  },
] as const

type Manifest = Readonly<{ name: string; exports?: Readonly<Record<string, string>> }>
/** Each workspace package by name: its directory and its export map. */
const PACKAGES = new Map(
  ['engine', 'fight', 'sdk', 'ui', 'protocol', 'immutable'].map((folder) => {
    const dir = resolve(REPOSITORY, 'packages', folder)
    const manifest = JSON.parse(readFileSync(resolve(dir, 'package.json'), 'utf8')) as Manifest
    return [manifest.name, { dir, exports: manifest.exports ?? {} }] as const
  })
)

const as_file = (base: string): string | null =>
  [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`].find(
    (candidate) => existsSync(candidate) && statSync(candidate).isFile()
  ) ?? null

/** A workspace import through its package's export map. Every workspace export names one file. */
const package_file = (name: string, subpath: string): string | null => {
  const workspace = PACKAGES.get(name)
  const file = workspace?.exports[subpath ? `./${subpath}` : '.']
  return workspace && file ? as_file(resolve(workspace.dir, file)) : null
}

/** A static value import or re-export: where it leads, or the bare package it names outside the repository. */
const resolve_import = (from: string, specifier: string): Readonly<{ file: string | null; external: string }> => {
  if (specifier.startsWith('.'))
    return { file: as_file(resolve(dirname(from), specifier.split('?')[0]!)), external: '' }
  const [, name = specifier, subpath = ''] = /^(@[^/]+\/[^/]+|[^/]+)(?:\/(.*))?$/.exec(specifier) ?? []
  return { file: package_file(name, subpath), external: PACKAGES.has(name) ? '' : name }
}

const STATIC_IMPORT = /^\s*(?:import|export)\s+(?!type\s)(?:[^'"]*?\sfrom\s+)?['"]([^'"]+)['"]/gm
const static_imports = (file: string): readonly string[] =>
  /\.(ts|tsx|js|mjs)$/.test(file)
    ? Array.from(readFileSync(file, 'utf8').matchAll(STATIC_IMPORT), ([, specifier]) => specifier!)
    : []

/** The game's own modules: the game's list imports them, the site's does not. */
const GAME_ONLY_MODULES = (() => {
  const imported = (file: string) =>
    new Set(static_imports(resolve(FRONTEND, file)).map((specifier) => resolve(FRONTEND, dirname(file), specifier)))
  const site = imported('src/site_modules.ts')
  return new Set(
    [...imported('src/game/game_modules.ts')]
      .filter((file) => file.includes('/src/modules/') && !site.has(file))
      .map((file) => relative(REPOSITORY, file))
  )
})()

type Edge = Readonly<{ from: string; to: string; file: string | null }>
const edges_of = (file: string): readonly Edge[] =>
  static_imports(file).flatMap((specifier) => {
    const { file: target, external } = resolve_import(file, specifier)
    const to = target ? relative(REPOSITORY, target) : external
    return to ? [{ from: relative(REPOSITORY, file), to, file: target }] : []
  })

/** A module that imports every file of a folder at load (Vite's eager glob): a page would load all of it. */
const EAGER_GLOB = /import\.meta\.glob\([^)]*eager:\s*true/s
const eager_globs = (edges: readonly Edge[]): readonly string[] =>
  [...new Set(edges.flatMap(({ file }) => (file && EAGER_GLOB.test(readFileSync(file, 'utf8')) ? [file] : [])))]
    .map((file) => `${relative(REPOSITORY, file)}: an eager import of a folder`)
    .toSorted()

const site_edges = (): readonly Edge[] => {
  const seen = new Set<string>(SITE_ROOTS)
  const pending = [...SITE_ROOTS]
  const edges: Edge[] = []
  while (pending.length > 0) {
    const next = edges_of(pending.pop()!)
    edges.push(...next)
    // The walk stops at an offending edge, so each one is reported once, at the site code that makes it.
    const allowed = next.filter((edge) => violation(edge) === null)
    const unseen = [...new Set(allowed.flatMap(({ file }) => (file && !seen.has(file) ? [file] : [])))]
    unseen.forEach((file) => seen.add(file))
    pending.push(...unseen)
  }
  return edges
}

const violation = ({ from, to }: Pick<Edge, 'from' | 'to'>): string | null => {
  if (to === 'three' || to.startsWith('three/')) return `${from} -> ${to}: Three.js`
  if (to.startsWith('packages/fight/') && !from.startsWith('packages/fight/') && !FIGHT_DOORS.has(from))
    return `${from} -> ${to}: the fight outside the protocol`
  const forbidden = FORBIDDEN.find(({ matches }) => matches(to))
  return forbidden ? `${from} -> ${to}: ${forbidden.reason}` : null
}

test('the site reaches no game code, no Three.js, no sign-in actions, only the content it reads, no eager art', () => {
  const edges = site_edges()
  // The walk is real: the site's store reaches the session and the one table it reads, and the market its icons.
  expect(edges.some(({ to }) => to === 'packages/frontend/src/modules/session.ts')).toBe(true)
  expect(edges.some(({ to }) => to === 'seed/content/items.json')).toBe(true)
  expect(edges.some(({ to }) => to === 'packages/frontend/src/content/assets.ts')).toBe(true)
  expect([...edges.flatMap((edge) => violation(edge) ?? []), ...eager_globs(edges)]).toEqual([])
})

test('the walk sees an edge into the game', () => {
  expect(violation({ from: 'packages/frontend/src/modules/session.ts', to: 'packages/frontend/src/game/x.ts' })).toBe(
    "packages/frontend/src/modules/session.ts -> packages/frontend/src/game/x.ts: the game's own code"
  )
  expect(violation({ from: 'packages/frontend/src/a.ts', to: 'three' })).not.toBeNull()
  expect(violation({ from: 'packages/frontend/src/a.ts', to: 'packages/fight/src/index.ts' })).not.toBeNull()
  expect(violation({ from: 'packages/protocol/src/packets.ts', to: 'packages/fight/src/index.ts' })).toBeNull()
  expect(violation({ from: 'packages/frontend/src/a.ts', to: 'seed/content/spells.json' })).not.toBeNull()
  expect(
    violation({ from: 'packages/frontend/src/a.ts', to: 'packages/frontend/src/modules/navigation.ts' })
  ).not.toBeNull()
  expect(violation({ from: 'packages/frontend/src/a.ts', to: 'packages/frontend/src/modules/session.ts' })).toBeNull()
  expect(EAGER_GLOB.test("import.meta.glob('../x/*.png', { eager: true, query: '?url' })")).toBe(true)
  expect(EAGER_GLOB.test("import.meta.glob('../x/*.glb', { query: '?url' })")).toBe(false)
})
