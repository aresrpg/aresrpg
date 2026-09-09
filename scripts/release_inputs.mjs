import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { promisify } from 'node:util'

// Canonical runtime input ownership for release builds. Version-only metadata is not a build input.
export const RELEASE_INPUTS = Object.freeze({
  frontend: Object.freeze([
    'packages/frontend/',
    'packages/engine/',
    'packages/sdk/',
    'packages/fight/',
    'packages/immutable/',
    'packages/protocol/',
    'seed/',
    'pins.json',
    'bun.lock',
    'vercel.json',
    'vite.config.',
    'scripts/browser_pins.ts',
    'scripts/release_inputs.mjs',
  ]),
  server: Object.freeze([
    'packages/server/',
    // The frozen workspace install reads every manifest copied by the server Dockerfile.
    'packages/engine/package.json',
    'packages/frontend/package.json',
    'packages/launchpad/package.json',
    'packages/sdk/package.json',
    'packages/fight/src/',
    'packages/fight/package.json',
    'packages/immutable/src/',
    'packages/immutable/package.json',
    'packages/protocol/src/',
    'packages/protocol/package.json',
    'seed/content/',
    'seed/structures/',
    'bun.lock',
    '.dockerignore',
    'scripts/release_inputs.mjs',
  ]),
  indexer: Object.freeze(['packages/indexer/', 'scripts/release_inputs.mjs']),
})

export const component_owns_path = (component, path) =>
  RELEASE_INPUTS[component].some((prefix) => path.startsWith(prefix))

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
  // Pins are checked against the selected chain separately. Seed ledgers must not trigger builds.
  files.delete('pins.json')
  const package_source =
    ref === null
      ? await readFile(resolve(cwd, 'package.json'), 'utf8')
      : await git(cwd, ['show', `${ref}:package.json`])
  const metadata = runtime_package_json(package_source)
  return fingerprint_runtime_files([...files], metadata, scope)
}

/** Local backend work excludes app files, but retains workspace manifests and all shared dependencies. */
export const fingerprint_runtime_files = (files, metadata, scope = 'all') => {
  if (scope !== 'all' && scope !== 'local') throw new Error('Unsupported runtime fingerprint scope')
  const selected = files.filter(
    ([path]) => scope !== 'local' || !path.startsWith('packages/frontend/') || path === 'packages/frontend/package.json'
  )
  return Object.freeze(
    Object.fromEntries(
      Object.keys(RELEASE_INPUTS).map((component) => {
        const inputs = selected
          .filter(([path, hash]) => hash !== null && component_owns_path(component, path))
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
