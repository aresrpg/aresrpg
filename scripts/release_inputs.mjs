import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { promisify } from 'node:util'

// Canonical runtime input ownership for release builds. Version-only metadata is not a build input.
export const JOURNAL_CONTENT_PREFIXES = ['packages/journal/content/', 'packages/journal/artwork/']

export const SCENE_COMPILER_FILES = Object.freeze([
  'scripts/generate_main_menu.mjs',
  'scripts/generate_adventure.mjs',
  'scripts/adventure_scene.ts',
  'scripts/encode_voxel_runs.mjs',
  'scripts/generate_asset_workshop.mjs',
  'scripts/bake_schematic.mjs',
  'scripts/partition_blocks.mjs',
  'scripts/bake_city_instances.mjs',
  'scripts/bake_thebes_assets.mjs',
  'scripts/building_kit.mjs',
  'scripts/module_connections.mjs',
  'scripts/module_transform.mjs',
  'scripts/constraint_layout.mjs',
  'scripts/compile_neighborhood.mjs',
  'scripts/townhouse.mjs',
  'scripts/main_menu_buildings.mjs',
  'scripts/main_menu_landmarks.mjs',
  'scripts/harbor_details.mjs',
])

export const RELEASE_INPUTS = Object.freeze({
  frontend: Object.freeze([
    ...SCENE_COMPILER_FILES,
    'packages/ui/',
    'packages/journal/public/assets/jetbrains-mono.woff2',
    'packages/frontend/',
    'packages/mobile/',
    'packages/engine/',
    'packages/sdk/',
    'packages/fight/',
    'packages/immutable/',
    'packages/protocol/',
    'seed/',
    'pins.json',
    'bun.lock',
    'patches/',
    'vercel.json',
    'vite.config.',
    'scripts/browser_pins.ts',
    'scripts/pin_vercel_deployment.ts',
    'scripts/release_inputs.mjs',
  ]),
  server: Object.freeze([
    'packages/server/',
    'packages/frontend/src/i18n/locales/',
    'packages/ui/src/assets/font/',
    'packages/frontend/public/branding/kares/',
    'seed/icons/currency/kares.png',
    'packages/frontend/public/branding/helmet-favicon.png',
    // The frozen workspace install reads every manifest copied by the server Dockerfile.
    'packages/bot/package.json',
    'packages/engine/package.json',
    'packages/ui/package.json',
    'packages/discord/package.json',
    'packages/frontend/package.json',
    'packages/mobile/package.json',
    'packages/journal/package.json',
    'packages/sdk/package.json',
    'packages/sdk/src/agent_pairing.ts',
    'packages/sdk/src/agent_multisig.ts',
    'packages/fight/src/',
    'packages/fight/package.json',
    'packages/immutable/src/',
    'packages/immutable/package.json',
    'packages/protocol/src/',
    'packages/protocol/package.json',
    'seed/content/',
    'seed/structures/',
    'bun.lock',
    'patches/',
    '.dockerignore',
    'scripts/release_inputs.mjs',
  ]),
  discord: Object.freeze([
    'packages/discord/',
    'packages/server/src/suins.ts',
    'packages/server/src/logger.ts',
    'packages/server/package.json',
    'packages/immutable/',
    'packages/ui/package.json',
    'packages/ui/src/base.css',
    'packages/ui/src/art.ts',
    'packages/ui/src/visual_identity.ts',
    'packages/ui/src/sui.ts',
    'packages/ui/src/assets/',
    'packages/frontend/src/i18n/locales/',
    'seed/icons/items/',
    'seed/icons/mobs/',
    'seed/content/items.json',
    'seed/content/mobs.json',
    'bun.lock',
    'patches/',
    '.dockerignore',
    'scripts/release_inputs.mjs',
    'packages/journal/package.json',
    'packages/fight/package.json',
    'packages/immutable/package.json',
    'packages/frontend/package.json',
    'packages/protocol/package.json',
    'packages/mobile/package.json',
    'packages/sdk/package.json',
    'packages/bot/package.json',
    'packages/engine/package.json',
  ]),
  bot: Object.freeze([
    'packages/bot/',
    'packages/engine/src/',
    'seed/content/worlds.json',
    'seed/content/structure_packs.json',
    'seed/structures/',
    'seed/scenes/thebes.recipe.json',
    'packages/sdk/src/',
    'packages/protocol/src/',
    'packages/fight/src/',
    'packages/immutable/src/',
    'seed/content/items.json',
    'seed/content/recipes.json',
    'seed/content/pet_wings.json',
    'seed/content/mobs.json',
    'seed/content/spells.json',
    'seed/portraits/manifest.json',
    'pins.json',
    'bun.lock',
    'patches/',
    'scripts/release_inputs.mjs',
  ]),
  indexer: Object.freeze(['packages/indexer/', 'scripts/release_inputs.mjs']),
})

export const component_owns_path = (component, path) =>
  (component === 'bot' && /^packages\/[^/]+\/package\.json$/.test(path)) ||
  RELEASE_INPUTS[component].includes(path) ||
  (!JOURNAL_CONTENT_PREFIXES.some((prefix) => path.startsWith(prefix)) &&
    RELEASE_INPUTS[component].some((prefix) => path.startsWith(prefix)))

export const classify_release = (paths) =>
  Object.freeze(
    Object.fromEntries(
      Object.keys(RELEASE_INPUTS).map((component) => [
        component,
        paths.some((path) => component_owns_path(component, path)),
      ])
    )
  )

export const runtime_package_json = (source) => {
  const { version: _version, ...runtime } = JSON.parse(source)
  return JSON.stringify(runtime)
}

const git = async (cwd, args) =>
  (
    await promisify(execFile)('git', args, {
      cwd,
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
    })
  ).stdout

const working_blobs = async (cwd) => {
  const [dirty, untracked] = await Promise.all([
    git(cwd, ['diff', '--name-only', '-z', 'HEAD']),
    git(cwd, ['ls-files', '--others', '--exclude-standard', '-z']),
  ])
  const paths = [...new Set((dirty + untracked).split('\0').filter(Boolean))].filter((path) =>
    Object.keys(RELEASE_INPUTS).some((component) => component_owns_path(component, path))
  )
  return Promise.all(
    paths.map(async (path) => {
      const bytes = await readFile(resolve(cwd, path)).catch((error) => {
        if (error.code === 'ENOENT') return null
        throw error
      })
      return [
        path,
        bytes === null ? null : createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex'),
      ]
    })
  )
}

// Parse with the pinned build runtime, then use the same pure selectors as both services.
// No YAML parser dependency or duplicate list of backend-consumed translation keys.
const locale_inputs = (sources) =>
  new Promise((resolve_inputs, reject) => {
    const module_url = new URL('../packages/immutable/src/locale.ts', import.meta.url).href
    const program = `
    import { allocation_locale, notification_locale } from ${JSON.stringify(module_url)}
    if (!Bun.YAML?.parse) throw new Error('Release locale inspection requires Bun with YAML support')
    const sources = await Bun.stdin.json()
    console.log(JSON.stringify(Object.fromEntries(Object.entries(sources).map(([path, source]) => {
      const document = Bun.YAML.parse(source)
      const server = allocation_locale(document)
      const discord = notification_locale(document)
      if (!server || typeof server !== 'object' || Array.isArray(server) || !discord.copy)
        throw new Error('Missing backend locale sections: ' + path)
      return [path, { server, discord }]
    }))))
  `
    const child = execFile(
      'bun',
      ['-e', program],
      { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
      (error, stdout) => {
        if (error) return reject(error)
        try {
          resolve_inputs(JSON.parse(stdout))
        } catch (failure) {
          reject(failure)
        }
      }
    )
    child.stdin.on('error', reject)
    child.stdin.end(JSON.stringify(sources))
  })

const locale_hashes = async (cwd, ref, files) => {
  const paths = [...files]
    .filter(([path, hash]) => hash !== null && /^packages\/frontend\/src\/i18n\/locales\/[^/]+\.yaml$/.test(path))
    .map(([path]) => path)
  if (!paths.length) return {}
  const sources = Object.fromEntries(
    await Promise.all(
      paths.map(async (path) => [
        path,
        ref === null ? await readFile(resolve(cwd, path), 'utf8') : await git(cwd, ['show', `${ref}:${path}`]),
      ])
    )
  )
  const inputs = await locale_inputs(sources)
  return Object.fromEntries(
    Object.entries(inputs).map(([path, components]) => [
      path,
      Object.fromEntries(
        Object.entries(components).map(([component, value]) => [
          component,
          createHash('sha256').update(JSON.stringify(value)).digest('hex'),
        ])
      ),
    ])
  )
}

export const runtime_fingerprints = async (cwd, ref = null, scope = 'all') => {
  const tree = await git(cwd, ['ls-tree', '-r', '-z', ref ?? 'HEAD'])
  const committed = tree
    .split('\0')
    .filter(Boolean)
    .map((row) => {
      const [metadata, path] = row.split('\t')
      return [path, metadata.split(' ')[2]]
    })
  const files = new Map([...committed, ...(ref === null ? await working_blobs(cwd) : [])])
  // The bot bundles SDK pins. Authored ledgers do not change its runtime identity.
  if (files.get('pins.json')) {
    const source =
      ref === null ? await readFile(resolve(cwd, 'pins.json'), 'utf8') : await git(cwd, ['show', `${ref}:pins.json`])
    const { seed_ledger: _ledger, ...pins } = JSON.parse(source)
    files.set('pins.json', createHash('sha256').update(JSON.stringify(pins)).digest('hex'))
  }
  const package_source =
    ref === null
      ? await readFile(resolve(cwd, 'package.json'), 'utf8')
      : await git(cwd, ['show', `${ref}:package.json`])
  const metadata = runtime_package_json(package_source)
  return fingerprint_runtime_files([...files], metadata, scope, await locale_hashes(cwd, ref, files))
}

/** Local backend work excludes app files, but retains workspace manifests and all shared dependencies. */
export const fingerprint_runtime_files = (files, metadata, scope = 'all', locales = {}) => {
  if (scope !== 'all' && scope !== 'local') throw new Error('Unsupported runtime fingerprint scope')
  const selected = files.filter(
    ([path]) =>
      scope !== 'local' ||
      !path.startsWith('packages/frontend/') ||
      Object.keys(RELEASE_INPUTS).some((component) => component !== 'frontend' && component_owns_path(component, path))
  )
  return Object.freeze(
    Object.fromEntries(
      Object.keys(RELEASE_INPUTS).map((component) => {
        const inputs = selected
          .filter(
            ([path, hash]) =>
              hash !== null && component_owns_path(component, path) && (path !== 'pins.json' || component === 'bot')
          )
          .map(([path, hash]) => [path, locales[path]?.[component] ?? hash])
          .sort(([left], [right]) => left.localeCompare(right))
        return [
          component,
          createHash('sha256')
            .update(JSON.stringify(inputs))
            .update(component === 'indexer' ? '' : metadata)
            .digest('hex'),
        ]
      })
    )
  )
}
