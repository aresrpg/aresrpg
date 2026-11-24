// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Release tooling core suite, artifact half: image inputs and fingerprints, image identity, the
// release manifest, the deployment pin, and the pinned contract build. release_gate.test.mjs holds
// CI lane selection, gate verdicts and release certification.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { expect, test } from 'bun:test'

import move_packages from '../../move-packages.json' with { type: 'json' }
import { create_contract_build_service } from '../deployment_build.ts'
import { classify_release, component_owns_path, runtime_fingerprints } from '../release_inputs.mjs'

const ROOT = fileURLToPath(new URL('../../', import.meta.url))
const read = (path) => readFileSync(resolve(ROOT, path), 'utf8')
const workflow = (name) => Bun.YAML.parse(read(`.github/workflows/${name}.yml`))
const with_directory = (run) => {
  const directory = mkdtempSync(join(tmpdir(), 'ares-release-tooling-'))
  try {
    return run(directory)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}
const bash = (script, options) => execFileSync('/bin/bash', ['-e', '-c', script], { stdio: 'pipe', ...options })
// Command doubles are shell functions defined ahead of the real script, never new executables.
const source_script = (doubles, path, ...args) => `${doubles}\n. '${resolve(ROOT, path)}' ${args.join(' ')}`
const CERTIFIED = `sha256:${'b'.repeat(64)}`
const MOVED = `sha256:${'a'.repeat(64)}`

test('an engine change rebuilds the server image, which copies and imports engine sources', () => {
  expect(classify_release(['packages/engine/src/data.ts']).server).toBe(true)
})

// Docker matches each path and each of its parent directories; the last matching rule decides.
const WILDCARDS = new Map([
  ['**/', '(?:.*/)?'],
  ['**', '.*'],
  ['*', '[^/]*'],
  ['?', '[^/]'],
])
const WILDCARD_TOKENS = /(\*\*\/?|\*|\?)/
const glob_part = (part) => WILDCARDS.get(part) ?? part.replace(/[.+^${}()|[\]\\]/g, '\\$&')
const glob_regex = (pattern) => new RegExp(`^${pattern.split(WILDCARD_TOKENS).map(glob_part).join('')}$`)
const context_filter = (ignore) => {
  const rules = ignore
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => ({
      negated: line.startsWith('!'),
      regex: glob_regex(line.replace(/^!/, '').replace(/^\/+|\/+$/g, '')),
    }))
  return (path) => {
    const parents = path
      .split('/')
      .slice(0, -1)
      .map((_, index, parts) => parts.slice(0, index + 1).join('/'))
    return !rules.reduce(
      (excluded, { negated, regex }) =>
        negated === excluded && (regex.test(path) || parents.some((parent) => regex.test(parent)))
          ? !negated
          : excluded,
      false
    )
  }
}
const copy_sources = (dockerfile) =>
  dockerfile
    .split('\n')
    .filter((line) => /^COPY\s/.test(line) && !line.includes('--from='))
    .flatMap((line) => line.trim().split(/\s+/).slice(1, -1))
    .map((source) => (source === '.' ? '' : source.replace(/^\.\//, '')))
const copied_by = (sources) => (path) =>
  sources.some(
    (source) => source === '' || path === source || path.startsWith(`${source}/`) || glob_regex(source).test(path)
  )

// Value imports only: an import used as a type alone is erased before the image runs it.
const transpilers = Object.fromEntries(
  ['ts', 'tsx', 'js'].map((loader) => [loader, new Bun.Transpiler({ loader, trimUnusedImports: true })])
)
const imports_of = (file, loader) =>
  transpilers[loader.startsWith('ts') ? loader : 'js'].scanImports(readFileSync(file, 'utf8'))
const import_closure = (entries) => {
  const seen = new Set()
  const visit = (file) => {
    if (seen.has(file)) return
    seen.add(file)
    const loader = file.match(/\.(tsx?|[cm]?js)$/)?.[1]
    for (const { path } of loader ? imports_of(file, loader) : []) {
      const target = Bun.resolveSync(path, dirname(file))
      if (target.startsWith(ROOT) && !target.includes('/node_modules/')) visit(target)
    }
  }
  entries.forEach((entry) => visit(resolve(ROOT, entry)))
  return [...seen].map((file) => relative(ROOT, file))
}

const BOT_IGNORE = 'packages/bot/Dockerfile.dockerignore'
const IMAGES = [
  { component: 'server', context: '', ignore: '.dockerignore', entries: ['packages/server/src/index.ts'] },
  { component: 'discord', context: '', ignore: '.dockerignore', entries: ['packages/discord/src/index.ts'] },
  {
    component: 'bot',
    context: '',
    ignore: BOT_IGNORE,
    entries: ['packages/bot/build.ts', 'packages/bot/src/index.ts'],
  },
  { component: 'indexer', context: 'packages/indexer/', ignore: null, entries: [] },
]

test('each image fingerprint covers every file its Dockerfile copies, and the image holds what its entry imports', () => {
  const tracked = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
    cwd: ROOT,
    encoding: 'utf8',
  })
    .split('\0')
    .filter((path) => path && existsSync(resolve(ROOT, path)))
  const gaps = IMAGES.flatMap(({ component, context, ignore, entries }) => {
    const dockerfile = `packages/${component}/Dockerfile`
    const admitted = ignore ? context_filter(read(ignore)) : () => true
    const sources = copy_sources(read(dockerfile))
    const image = tracked.filter(
      (path) =>
        path.startsWith(context) &&
        admitted(path.slice(context.length)) &&
        copied_by(sources)(path.slice(context.length))
    )
    expect({ component, files: image.length > 0 }).toEqual({ component, files: true })
    // A moved or deleted path that a Dockerfile still copies fails the image build.
    const absent_sources = sources.filter(
      (source) => !image.some((path) => copied_by([source])(path.slice(context.length)))
    )
    const in_image = new Set(image)
    const missing_from_image = import_closure(entries).filter((path) => !in_image.has(path))
    const unfingerprinted = [...image, dockerfile, ...(ignore ? [ignore] : [])].filter(
      (path) => path !== 'package.json' && !component_owns_path(component, path)
    )
    return [
      ...absent_sources.map((source) => `${dockerfile} copies missing ${source}`),
      ...missing_from_image.map((path) => `${component} image lacks imported ${path}`),
      ...unfingerprinted.map((path) => `${component} fingerprint omits ${path}`),
    ]
  })
  expect(gaps).toEqual([])
})

test('runtime fingerprints ignore the version, browser-only copy and pin ledgers, never a consumed input', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'ares-release-tooling-'))
  try {
    const locale = join(directory, 'packages/frontend/src/i18n/locales/en.yaml')
    const copy =
      'allocation_page:\n  title: Allocation\ndiscord_marketplace:\n  title: Market\nsimulator_page:\n  stat_health: Health\n  unused_label: Browser only\n'
    const pins = (pkg, ledger) => JSON.stringify({ network: 'mainnet', package: pkg, seed_ledger: { a: ledger } })
    mkdirSync(dirname(locale), { recursive: true })
    writeFileSync(join(directory, 'package.json'), '{"version":"1.0.0"}')
    writeFileSync(join(directory, 'pins.json'), pins('0x1', 1))
    writeFileSync(locale, copy)
    const git = (...args) => execFileSync('git', args, { cwd: directory, stdio: 'pipe' })
    const identity = ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid']
    git('init', '-q')
    git('add', '.')
    git(...identity, '-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'fixture')
    const before = await runtime_fingerprints(directory, 'HEAD')
    const changed = async (scope = 'all', baseline = before) => {
      const after = await runtime_fingerprints(directory, null, scope)
      return Object.keys(after).filter((component) => after[component] !== baseline[component])
    }
    writeFileSync(join(directory, 'package.json'), '{"version":"1.0.1"}')
    writeFileSync(join(directory, 'pins.json'), pins('0x1', 2))
    expect(await changed()).toEqual([])
    // Local backend recovery ignores app-only edits that a full release fingerprint retains.
    const local = await runtime_fingerprints(directory, 'HEAD', 'local')
    writeFileSync(join(directory, 'packages/frontend/src/app.tsx'), 'export {}\n')
    expect([await changed(), await changed('local', local)]).toEqual([['frontend'], []])
    rmSync(join(directory, 'packages/frontend/src/app.tsx'))
    for (const [from, to, expected] of [
      ['unused_label: Browser only', 'unused_label: New browser copy', ['frontend']],
      ['title: Allocation', 'title: New allocation', ['frontend', 'server']],
      ['title: Market', 'title: New notification', ['frontend', 'discord']],
      ['stat_health: Health', 'stat_health: Hit points', ['frontend', 'discord']],
    ]) {
      writeFileSync(locale, copy.replace(from, to))
      expect({ from, changed: await changed() }).toEqual({ from, changed: expected })
    }
    writeFileSync(locale, copy)
    writeFileSync(join(directory, 'pins.json'), pins('0x2', 2))
    expect(await changed()).toEqual(['bot'])
    writeFileSync(locale, 'allocation_page: [unterminated')
    await expect(runtime_fingerprints(directory)).rejects.toThrow()
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

const image_step = (mode, { changed, existing = CERTIFIED, digest = CERTIFIED, revision = '1'.repeat(40) }) =>
  with_directory((directory) => {
    writeFileSync(join(directory, 'digest'), existing ?? '')
    writeFileSync(join(directory, 'output'), '')
    // The registry holds one tag whose digest a create can move only to the certified source digest.
    const docker = `docker() {
  printf '%s\\n' "$*" >> "$DIR/calls"
  if [ "$1" = manifest ]; then [ -z "\${ABSENT:-}" ]; return; fi
  if [ "\${6:-}" = '{{json .Image.Config.Labels}}' ]; then printf '{"org.opencontainers.image.revision":"%s"}\\n' "$REVISION"; return 0; fi
  if [ "$3" = create ]; then [ "\${!#}" != "$IMAGE_REPOSITORY@$IMAGE_DIGEST" ] || printf '%s' "$IMAGE_DIGEST" > "$DIR/digest"; return 0; fi
  case "$4" in *@*) printf '"%s"\\n' "\${4##*@}" ;; *) printf '"%s"\\n' "$(cat "$DIR/digest")" ;; esac
}`
    const env = {
      ...process.env,
      DIR: directory,
      GITHUB_OUTPUT: join(directory, 'output'),
      GITHUB_SHA: '1'.repeat(40),
      IMAGE_REPOSITORY: 'ghcr.io/aresrpg/server',
      IMAGE_VERSION: '2.0.0',
      IMAGE_DIGEST: digest,
      IMAGE_CHANGED: String(changed),
      REVISION: revision,
      ...(existing === null ? { ABSENT: '1' } : {}),
    }
    try {
      execFileSync('/bin/bash', ['-c', source_script(docker, 'scripts/release_image.sh', mode)], { env, stdio: 'pipe' })
      return { output: read(join(directory, 'output')), calls: read(join(directory, 'calls')) }
    } catch {
      return null
    }
  })

test('an image semver is reused only for its exact source revision and certified digest', () => {
  expect(image_step('inspect', { changed: true, existing: null }).output).toBe('exists=false\n')
  expect(image_step('inspect', { changed: true }).output).toContain(`digest=${CERTIFIED}`)
  expect(image_step('inspect', { changed: true, revision: '2'.repeat(40) })).toBeNull()
  expect(image_step('inspect', { changed: false }).output).toContain(`digest=${CERTIFIED}`)
  expect(image_step('inspect', { changed: false, existing: MOVED })).toBeNull()
  expect(image_step('inspect', { changed: false, digest: 'latest' })).toBeNull()
  const alias = image_step('alias', { changed: false, existing: MOVED })
  expect(alias.output).toContain(`digest=${CERTIFIED}`)
  expect(alias.calls).toContain(
    `--prefer-index=false --tag ghcr.io/aresrpg/server:2.0.0 ghcr.io/aresrpg/server@${CERTIFIED}`
  )
})

test('a backend plan reuses images only from a certified mainnet preparation of the previous tag', () => {
  const plan = workflow('release').jobs['backend-plan'].steps.find(({ id }) => id === 'plan').run
  const run_plan = (manifest) =>
    with_directory((directory) => {
      // `gh run download` finds the previous preparation's manifest already in place.
      mkdirSync(join(directory, 'previous-release'))
      writeFileSync(join(directory, 'previous-release/release-manifest.json'), JSON.stringify(manifest))
      const script = `git() { printf '${'1'.repeat(40)}\\n'; }
gh() { [ "$2" != list ] || echo 123; }
previous_tag=v1.0.0; server=false; indexer=false; frontend=false; discord=false; bot=false
server_digest=''; indexer_digest=''; discord_digest=''; bot_digest=''
if true; then
${plan.slice(plan.indexOf('  previous_run=')).replace('${GITHUB_REPOSITORY_OWNER,,}', 'aresrpg')}`
      const env = { ...process.env, RUNNER_TEMP: directory, SUI_NETWORK: 'mainnet' }
      bash(script, { env: { ...env, GITHUB_OUTPUT: join(directory, 'output') } })
      return Object.fromEntries(
        read(join(directory, 'output'))
          .trim()
          .split('\n')
          .map((line) => line.split('='))
      )
    })
  const images = (names) =>
    Object.fromEntries(names.map((name) => [name, { repository: `ghcr.io/aresrpg/${name}`, digest: CERTIFIED }]))
  const certified = {
    schema: 2,
    status: 'prepared',
    source_sha: '1'.repeat(40),
    version: '1.0.0',
    network: 'mainnet',
    images: images(['server', 'indexer', 'discord', 'bot']),
  }
  const reused = run_plan(certified)
  for (const name of ['server', 'indexer', 'discord', 'bot']) {
    expect(reused[name]).toBe('false')
    expect(reused[`${name}_digest`]).toBe(CERTIFIED)
  }
  const without_bot = run_plan({ ...certified, images: images(['server', 'indexer', 'discord']) })
  expect([without_bot.bot, without_bot.server, without_bot.discord]).toEqual(['true', 'false', 'false'])
  for (const foreign of [
    { ...certified, network: 'testnet' },
    { ...certified, source_sha: '2'.repeat(40) },
    {
      ...certified,
      images: { ...certified.images, server: { repository: 'ghcr.io/foreign/server', digest: CERTIFIED } },
    },
    {
      ...certified,
      images: { ...certified.images, indexer: { repository: 'ghcr.io/aresrpg/indexer', digest: 'latest' } },
    },
  ]) {
    const rebuilt = run_plan(foreign)
    for (const name of ['server', 'indexer', 'discord', 'bot', 'frontend']) expect(rebuilt[name]).toBe('true')
  }
})

test('the release manifest passes activation, which refuses a missing, foreign or malformed bot image', () => {
  with_directory((directory) => {
    const sha = '1'.repeat(40)
    // Every image digest answers anonymously in this registry double.
    const activation = `docker() { :; }\n${workflow('activate-production')
      .jobs.activate.steps.find(({ id }) => id === 'manifest')
      .run.replaceAll('${{ steps.release.outputs.source_sha }}', sha)
      .replaceAll('${{ steps.release.outputs.version }}', '2.0.0')}`
    const env = {
      ...process.env,
      RUNNER_TEMP: directory,
      GITHUB_STEP_SUMMARY: join(directory, 'summary'),
      GITHUB_OUTPUT: join(directory, 'output'),
      GITHUB_SHA: sha,
      SUI_NETWORK: 'mainnet',
      VERSION: '2.0.0',
      PREVIOUS_TAG: 'v1.0.0',
      VERCEL_URL: '',
      FRONTEND_BUILT: 'false',
      ...Object.fromEntries(
        ['BOT', 'SERVER', 'INDEXER', 'DISCORD'].flatMap((name) => [
          [`${name}_DIGEST`, CERTIFIED],
          [`${name}_BUILT`, 'true'],
        ])
      ),
    }
    const packages = ['math_', 'control_', 'combat_', 'seed_', ''].flatMap((prefix) => [
      [`${prefix}package`, '0x1'],
      [`${prefix}package_original`, '0x1'],
    ])
    writeFileSync(join(directory, 'pins.json'), JSON.stringify({ network: 'mainnet', ...Object.fromEntries(packages) }))
    const write_manifest = (overrides = {}) =>
      bash(read('scripts/release_manifest.sh'), { cwd: directory, env: { ...env, ...overrides } })
    expect(() => write_manifest({ BOT_DIGEST: '' })).toThrow()
    write_manifest()
    const path = join(directory, 'production-release/release-manifest.json')
    const manifest = JSON.parse(readFileSync(path, 'utf8'))
    expect(manifest.schema).toBe(2)
    expect(manifest.images.bot).toEqual({
      repository: 'ghcr.io/aresrpg/bot',
      version: '2.0.0',
      digest: CERTIFIED,
      built: true,
    })
    bash(activation, { env })
    expect(readFileSync(env.GITHUB_OUTPUT, 'utf8')).toContain('frontend=false')
    const { bot } = manifest.images
    for (const invalid of [
      { ...manifest, schema: 1 },
      { ...manifest, source_sha: '2'.repeat(40) },
      { ...manifest, images: { ...manifest.images, bot: null } },
      { ...manifest, images: { ...manifest.images, bot: { ...bot, digest: 'latest' } } },
      { ...manifest, images: { ...manifest.images, bot: { ...bot, repository: 'ghcr.io/foreign/bot' } } },
    ]) {
      writeFileSync(path, JSON.stringify(invalid))
      expect(() => bash(activation, { env })).toThrow()
    }
  })
})

test('the deployment pin admits only the configured HTTPS bot origin and a valid deployment ID', () => {
  const pin = ({ origin, id = 'ares-fixture' }) =>
    with_directory((directory) => {
      const config = {
        version: 3,
        routes: [{ src: '/(.*)', headers: { 'Content-Security-Policy': "connect-src 'self'" } }],
      }
      mkdirSync(join(directory, '.vercel/output'), { recursive: true })
      writeFileSync(join(directory, '.vercel/output/config.json'), JSON.stringify(config))
      writeFileSync(join(directory, '.vercel/.env.local'), origin ? `VITE_BOT_SERVICE_URL=${origin}\n` : '')
      const child = Bun.spawnSync(
        [process.execPath, '--env-file=.vercel/.env.local', resolve(ROOT, 'scripts/pin_vercel_deployment.ts')],
        { cwd: directory, env: { ...process.env, VITE_BOT_SERVICE_URL: undefined, ARES_DEPLOYMENT_ID: id } }
      )
      const result = read(join(directory, '.vercel/output/config.json'))
      return child.exitCode === 0 ? JSON.parse(result) : { refused: true, unchanged: result === JSON.stringify(config) }
    })
  const pinned = pin({ origin: 'https://bot.example.test' })
  expect(pinned.deploymentId).toBe('ares-fixture')
  expect(pinned.routes[0].headers['Content-Security-Policy']).toBe("connect-src 'self' https://bot.example.test")
  expect(pin({}).routes[0].headers['Content-Security-Policy']).toBe("connect-src 'self'")
  expect(pin({ origin: 'http://bot.example.test' })).toEqual({ refused: true, unchanged: true })
  expect(pin({ id: 'dpl_forged' })).toEqual({ refused: true, unchanged: true })
})

// The version line of the pinned release: its number and the first twelve characters of its commit.
const PINNED_COMPILER = `sui ${move_packages.sui_cli.release.split('-v')[1]}-${move_packages.sui_cli.revision.slice(0, 12)}`
const compiler = (overrides) => create_contract_build_service({ repo_dir: import.meta.dir, ...overrides })

test('contract artifacts come only from the pinned Sui compiler: number and commit', async () => {
  for (const stdout of ['sui 0.0.0-wrong', `sui ${move_packages.sui_cli.release.split('-v')[1]}-000000000000`]) {
    const calls = []
    const run = async (command, args) => {
      calls.push([command, ...args])
      return { stdout, stderr: '' }
    }
    await expect(compiler({ run }).compile_math('testnet')).rejects.toThrow('Sui compiler')
    expect(calls).toEqual([['sui', '--version']])
  }
  const build = JSON.stringify({ modules: ['AA=='], dependencies: ['0x2'], digest: [1] })
  const run = async (_command, args) => ({ stdout: args[0] === '--version' ? PINNED_COMPILER : build, stderr: '' })
  expect((await compiler({ run }).compile_math('testnet')).modules).toEqual(['AA=='])
})

test('the liquidity token resolves Aftermath on the build network and publishes with its whole linkage', async () => {
  const builds = []
  let publication = ''
  const run = async (_command, args) => {
    if (args[0] === '--version') return { stdout: PINNED_COMPILER, stderr: '' }
    if (args.includes('chain-identifier')) return { stdout: '35834a8a', stderr: '' }
    builds.push(args)
    if (args.includes('--pubfile-path')) publication = await Bun.file(args[args.indexOf('--pubfile-path') + 1]).text()
    return {
      stdout: JSON.stringify({ modules: ['AA=='], dependencies: ['0x1', '0x2', '0xa5'], digest: [1] }),
      stderr: '',
    }
  }
  const service = compiler({
    run,
    read_version: async () => '5',
    read_linkage: async (network, package_id) => [`${network}:${package_id}`, '0x2', '0xdep'],
  })
  expect((await service.compile_currency('mainnet')).package_name).toBe('aresrpg_currency')
  const token = await service.compile_currency_lp('mainnet', { package: '0xa5', original_package: '0xa1' })
  expect(token.dependencies).toEqual(['0x1', '0x2', '0xa5', 'mainnet:0xa5', '0xdep'])
  // Only the build with an outside dependency names the client network; the currency build stays plain.
  expect(builds.map((args) => args.slice(0, 3))).toEqual([
    ['move', 'build', '--path'],
    ['move', '--client.env', 'mainnet'],
  ])
  expect(publication).toContain('published-at = "0xa5"')
  expect(publication).toContain('original-id = "0xa1"')
  expect(publication).toContain('currency-lp/aftermath')
})

test('an upgrade build binds its published version from metadata and stops once on a bad read', async () => {
  let publication = ''
  const reads = []
  const run = async (_command, args) => {
    if (args.includes('object')) throw new Error('EOF while parsing a value')
    if (args[0] === '--version') return { stdout: PINNED_COMPILER, stderr: '' }
    if (args.includes('chain-identifier')) return { stdout: '4c78adac', stderr: '' }
    publication = await Bun.file(args[args.indexOf('--pubfile-path') + 1]).text()
    return { stdout: JSON.stringify({ modules: ['AA=='], dependencies: ['0x2'], digest: [1] }), stderr: '' }
  }
  const read_version = async (network, package_id) => {
    reads.push([network, package_id])
    return '2'
  }
  await compiler({ run, read_version }).compile_math('testnet', { package: '0x123', original_package: '0xabc' })
  expect(reads).toEqual([['testnet', '0x123']])
  expect(publication).toContain('version = 2')
  expect(publication).toContain('original-id = "0xabc"')
  for (const response of [new Error('metadata unavailable'), '0', '1.5', 'invalid', '9007199254740992']) {
    let attempts = 0
    let builds = 0
    const failing = compiler({
      read_version: async () => {
        attempts += 1
        if (response instanceof Error) throw response
        return response
      },
      run: async (_command, args) => {
        if (args[0] === 'move') builds += 1
        return { stdout: args[0] === '--version' ? PINNED_COMPILER : '4c78adac', stderr: '' }
      },
    })
    await expect(failing.compile_math('testnet', { package: '0x123' })).rejects.toThrow(
      'Cannot read testnet package 0x123 version:'
    )
    expect([attempts, builds]).toEqual([1, 0])
  }
})

test('the upgrade meter checks the exact candidate modules and never approves without a verdict', async () => {
  const metered = []
  const artifact = { package_name: 'aresrpg', modules: ['AQID', 'BAUG'], dependencies: [], digest: [1] }
  const read_protocol = async (network) => {
    expect(network).toBe('mainnet')
    return '139'
  }
  const run = async (_command, args) => {
    if (args[0] === '--version') return { stdout: PINNED_COMPILER, stderr: '' }
    expect(args.slice(0, 4)).toEqual(['client', 'verify-bytecode-meter', '--protocol-version', '139'])
    for (const [index, arg] of args.entries())
      if (arg === '--module') metered.push([...new Uint8Array(await Bun.file(args[index + 1]).arrayBuffer())])
    return { stdout: 'Running bytecode verifier\n{"success":true}', stderr: '' }
  }
  await compiler({ run, read_protocol }).verify_bytecode('mainnet', artifact)
  expect(metered).toEqual([
    [1, 2, 3],
    [4, 5, 6],
  ])
  for (const success of [false, undefined]) {
    const verdict = async (_command, args) => ({
      stdout: args[0] === '--version' ? PINNED_COMPILER : JSON.stringify({ success }),
      stderr: '',
    })
    await expect(compiler({ run: verdict, read_protocol }).verify_bytecode('mainnet', artifact)).rejects.toThrow(
      'bytecode verifier'
    )
  }
  const unavailable = async () => {
    throw new Error('protocol unavailable')
  }
  const pinned = async () => ({ stdout: PINNED_COMPILER, stderr: '' })
  await expect(
    compiler({ run: pinned, read_protocol: unavailable }).verify_bytecode('mainnet', artifact)
  ).rejects.toThrow('protocol unavailable')
})
