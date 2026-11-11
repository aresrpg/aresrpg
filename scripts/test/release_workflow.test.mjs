// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test } from 'bun:test'

const source = readFileSync(new URL('../../.github/workflows/release.yml', import.meta.url), 'utf8')
const backend_plan = source.slice(source.indexOf('  backend-plan:'), source.indexOf('  build-server:'))
const workflow = Bun.YAML.parse(source)
const activation = Bun.YAML.parse(
  readFileSync(new URL('../../.github/workflows/activate-production.yml', import.meta.url), 'utf8')
)

const manifest_script = readFileSync(new URL('../release_manifest.sh', import.meta.url), 'utf8')

const certified_digest = `sha256:${'b'.repeat(64)}`
const moved_tag_digest = `sha256:${'a'.repeat(64)}`

test('activation checkout contains every patch required by the locked install', () => {
  const manifest = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'))
  const checkout = activation.jobs.activate.steps.find(({ uses }) => uses?.startsWith('actions/checkout@'))
  const paths = checkout.with['sparse-checkout']
    .trim()
    .split('\n')
    .map((path) => path.replace(/^\//, ''))
  const files = execFileSync('git', ['ls-files', '--', ...paths], {
    cwd: new URL('../../', import.meta.url),
    encoding: 'utf8',
  })
    .trim()
    .split('\n')
  for (const patch of Object.values(manifest.patchedDependencies ?? {})) expect(files).toContain(patch)
})

const run_baseline_plan = (network, include_discord = true, include_bot = true) => {
  const directory = mkdtempSync(join(tmpdir(), 'ares-release-baseline-'))
  const output = join(directory, 'output')
  const plan = workflow.jobs['backend-plan'].steps.find(({ id }) => id === 'plan').run
  const script = `previous_tag=v1.0.0; server=false; indexer=false; frontend=false; discord=false; bot=false
server_digest=''; indexer_digest=''; discord_digest=''; bot_digest=''
if true; then
${plan.slice(plan.indexOf('  previous_run=')).replace('${GITHUB_REPOSITORY_OWNER,,}', 'aresrpg')}`
  try {
    writeFileSync(
      join(directory, 'manifest.json'),
      JSON.stringify({
        schema: 1,
        status: 'prepared',
        source_sha: '1'.repeat(40),
        version: '1.0.0',
        network,
        images: Object.fromEntries(
          ['server', 'indexer', ...(include_discord ? ['discord'] : []), ...(include_bot ? ['bot'] : [])].map(
            (name) => [
              name,
              {
                repository: `ghcr.io/aresrpg/${name}`,
                digest: certified_digest,
              },
            ]
          )
        ),
      })
    )
    writeFileSync(join(directory, 'git'), `#!/bin/sh\nprintf '${'1'.repeat(40)}\\n'\n`, { mode: 0o700 })
    writeFileSync(
      join(directory, 'gh'),
      `#!/bin/bash
if [ "$2" = list ]; then echo 123; exit 0; fi
mkdir -p "$RUNNER_TEMP/previous-release"
cp "$RUNNER_TEMP/manifest.json" "$RUNNER_TEMP/previous-release/release-manifest.json"
`,
      { mode: 0o700 }
    )
    execFileSync('/bin/bash', ['-e', '-c', script], {
      env: {
        PATH: `${directory}:${process.env.PATH}`,
        RUNNER_TEMP: directory,
        GITHUB_OUTPUT: output,
        GITHUB_REPOSITORY_OWNER: 'aresrpg',
        SUI_NETWORK: 'mainnet',
      },
      stdio: 'pipe',
    })
    return readFileSync(output, 'utf8')
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

test('a previous testnet release triggers a full mainnet build instead of aborting preparation', () => {
  const output = run_baseline_plan('testnet')
  for (const component of ['server', 'indexer', 'frontend', 'discord', 'bot'])
    expect(output).toContain(`${component}=true`)
  expect(output).toContain('server_digest=\n')
  expect(output).toContain('indexer_digest=\n')
})

test('a certified mainnet baseline retains the fast path for unchanged runtime inputs', () => {
  const output = run_baseline_plan('mainnet')
  for (const component of ['server', 'indexer', 'frontend', 'discord', 'bot'])
    expect(output).toContain(`${component}=false`)
  expect(output).toContain(`server_digest=${certified_digest}`)
  expect(output).toContain(`indexer_digest=${certified_digest}`)
})

const run_image_step = (component, step_id, current_digest, changed = false, revision = '1'.repeat(40)) => {
  const directory = mkdtempSync(join(tmpdir(), 'ares-image-identity-'))
  const output = join(directory, 'output')
  const calls = join(directory, 'calls')
  const digest_file = join(directory, 'digest')
  const values = {
    'github.repository_owner': 'aresrpg',
    [`needs.backend-plan.outputs.${component}`]: String(changed),
    'needs.backend-plan.outputs.version': '2.0.0',
    [`needs.backend-plan.outputs.${component}_digest`]: certified_digest,
    'needs.backend-plan.outputs.previous_tag': 'v1.0.0',
  }
  const step = workflow.jobs[`build-${component}`].steps.find(({ id }) => id === step_id)
  const interpolate = (source) =>
    source.replace(/\$\{\{\s*([^}]+?)\s*\}\}/g, (_, expression) => {
      const value = values[expression.trim()]
      if (value === undefined) throw new Error(`Unexpected workflow input ${expression}`)
      return value
    })
  try {
    writeFileSync(digest_file, current_digest)
    writeFileSync(output, '')
    writeFileSync(
      join(directory, 'docker'),
      `#!/bin/bash
set -eu
printf '%s\\n' "$*" >> "$CALLS_PATH"
if [ "$1" = manifest ]; then exit 0; fi
if [ "$6" = '{{json .Image.Config.Labels}}' ]; then
  printf '{"org.opencontainers.image.revision":"%s"}\\n' "$IMAGE_REVISION"
  exit 0
fi
if [ "$3" = create ]; then
  source_ref="\${!#}"
  if [ "$source_ref" = "$IMAGE_REPOSITORY@$EXPECTED_DIGEST" ]; then
    printf '%s' "$EXPECTED_DIGEST" > "$DIGEST_FILE"
  else
    printf '%s' "$MOVED_TAG_DIGEST" > "$DIGEST_FILE"
  fi
  exit 0
fi
case "$4" in
  *@*) digest="\${4##*@}" ;;
  *:1.0.0) digest="$MOVED_TAG_DIGEST" ;;
  *) digest="$(cat "$DIGEST_FILE")" ;;
esac
printf '"%s"\\n' "$digest"
`,
      { mode: 0o700 }
    )
    execFileSync('/bin/bash', ['-e', '-c', interpolate(step.run)], {
      cwd: new URL('../../', import.meta.url),
      env: {
        ...Object.fromEntries(
          Object.entries(workflow.jobs[`build-${component}`].env).map(([key, value]) => [key, interpolate(value)])
        ),
        PATH: `${directory}:/usr/bin:/bin`,
        GITHUB_OUTPUT: output,
        GITHUB_SHA: '1'.repeat(40),
        IMAGE_REPOSITORY: `ghcr.io/aresrpg/${component}`,
        EXPECTED_DIGEST: certified_digest,
        IMAGE_REVISION: revision,
        MOVED_TAG_DIGEST: moved_tag_digest,
        CALLS_PATH: calls,
        DIGEST_FILE: digest_file,
      },
      stdio: 'pipe',
    })
    return { output: readFileSync(output, 'utf8'), calls: readFileSync(calls, 'utf8') }
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

for (const component of ['server', 'indexer', 'discord', 'bot']) {
  test(`${component}: changed images only reuse the exact source revision`, () => {
    expect(() => run_image_step(component, 'image', certified_digest, true, '2'.repeat(40))).toThrow()
    expect(run_image_step(component, 'image', certified_digest, true).output).toContain(`digest=${certified_digest}`)
  })

  test(`${component}: reruns attest the reused exact-source digest and reject malformed identities`, () => {
    const attestation = workflow.jobs[`build-${component}`].steps.find(({ uses }) =>
      uses?.startsWith('actions/attest@')
    )
    expect(attestation.if).toBe(`needs.backend-plan.outputs.${component} == 'true'`)
    expect(attestation.with['subject-digest']).toBe('${{ steps.image.outputs.digest || steps.build.outputs.digest }}')
    expect(run_image_step(component, 'image', certified_digest, true).output).toContain(`digest=${certified_digest}`)
    expect(() => run_image_step(component, 'image', 'latest', true)).toThrow()
  })

  test(`${component}: alias copies the certified digest even when the previous tag has moved`, () => {
    const result = run_image_step(component, 'alias', moved_tag_digest)
    expect(result.output).toContain(`digest=${certified_digest}`)
    expect(result.calls).toContain(`ghcr.io/aresrpg/${component}@${certified_digest}`)
    expect(result.calls).toContain('--prefer-index=false')
  })

  test(`${component}: a rerun refuses an existing semver that differs from the certified digest`, () => {
    expect(() => run_image_step(component, 'image', moved_tag_digest)).toThrow()
    expect(run_image_step(component, 'image', certified_digest).output).toContain(`digest=${certified_digest}`)
  })
}

test('the previous preparation must bind both image digests to the expected release source', () => {
  const plan = workflow.jobs['backend-plan'].steps.find(({ id }) => id === 'plan').run
  const filter = plan.match(/--arg repository [^\n]*'([\s\S]*?)'\s+"\$previous_manifest"/)?.[1]
  expect(filter).toBeDefined()
  const manifest = {
    schema: 1,
    status: 'prepared',
    source_sha: '1'.repeat(40),
    version: '1.0.0',
    network: 'mainnet',
    images: {
      server: { repository: 'ghcr.io/aresrpg/server', digest: certified_digest },
      indexer: { repository: 'ghcr.io/aresrpg/indexer', digest: certified_digest },
    },
  }
  const validate = (value) =>
    execFileSync(
      'jq',
      [
        '-e',
        '--arg',
        'sha',
        '1'.repeat(40),
        '--arg',
        'version',
        '1.0.0',
        '--arg',
        'repository',
        'ghcr.io/aresrpg',
        filter,
      ],
      { input: JSON.stringify(value), stdio: 'pipe' }
    )
  validate(manifest)
  for (const invalid of [
    { ...manifest, schema: 3 },
    { ...manifest, source_sha: '2'.repeat(40) },
    { ...manifest, version: '2.0.0' },
    {
      ...manifest,
      images: { ...manifest.images, server: { repository: 'ghcr.io/foreign/server', digest: certified_digest } },
    },
    { ...manifest, images: { ...manifest.images, indexer: { ...manifest.images.indexer, digest: 'latest' } } },
    { ...manifest, images: { ...manifest.images, indexer: { repository: 'ghcr.io/aresrpg/indexer' } } },
  ])
    expect(() => validate(invalid)).toThrow()
})

test('CI consumes the canonical runtime input classifier', () => {
  expect(backend_plan).toContain("import { runtime_fingerprints } from './scripts/release_inputs.mjs'")
  expect(backend_plan).toContain('before[key] !== after[key]')
})

test('release preparation is mainnet-only and conditionally stages frontend', () => {
  expect(workflow.on.push).toBeUndefined()
  expect(workflow.on.workflow_dispatch.inputs.network).toBeUndefined()
  expect(workflow.env.SUI_NETWORK).toBe('mainnet')
  expect(workflow.jobs['prepare-production'].if).toBe("needs.backend-plan.outputs.frontend == 'true'")
  expect(workflow.jobs['prepare-production'].env.VITE_NETWORK).toBe('mainnet')
})

test('activation uses one exact preparation receipt and skips unchanged frontend promotion', () => {
  expect(activation.on.workflow_dispatch.inputs.preparation_run.required).toBe(true)
  expect(activation['run-name']).toBe(
    'activate v${{ inputs.version }} mainnet ${{ inputs.request_id }} ${{ inputs.preparation_run }}'
  )
  const promotion = activation.jobs.activate.steps.find(
    ({ name }) => name === 'promote the prepared deployment without rebuilding'
  )
  expect(promotion.if).toBe("steps.manifest.outputs.frontend == 'true'")
})

test('every CI Bun installation reads the repository version and Vercel runs from a frozen install', () => {
  const { devDependencies } = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'))
  expect(devDependencies.vercel).toMatch(/^\d+\.\d+\.\d+$/)
  const jobs = ['gate', 'deploy', 'release', 'activate-production'].flatMap((name) =>
    Object.values(
      Bun.YAML.parse(readFileSync(new URL(`../../.github/workflows/${name}.yml`, import.meta.url), 'utf8')).jobs
    )
  )
  const bun_steps = jobs.flatMap(({ steps }) => steps).filter(({ uses }) => uses?.startsWith('oven-sh/setup-bun@'))
  for (const step of bun_steps) {
    expect(step.with['bun-version-file']).toBe('package.json')
    expect(step.with['bun-version']).toBeUndefined()
  }
  for (const job of jobs) {
    for (const [index, step] of job.steps.entries()) {
      if (!step.run?.includes('vercel ')) continue
      expect(step.run).not.toMatch(/bunx vercel/)
      expect(step.run).toContain('bun run vercel ')
      expect(job.steps.slice(0, index).some(({ run }) => /bun install.*--frozen-lockfile/.test(run ?? ''))).toBe(true)
    }
  }
  const checkout = activation.jobs.activate.steps.find(({ uses }) => uses?.startsWith('actions/checkout@'))
  expect(checkout.with['sparse-checkout']).toContain('/bun.lock')
  expect(checkout.with['sparse-checkout']).toContain('/packages/*/package.json')
})

test('release builds overlap verification but certification requires the green gate', () => {
  const verification = workflow.jobs['verify-gate']
  expect(verification).toBeDefined()
  expect(verification.needs).toBe('tag-and-release')
  const manifest = workflow.jobs['release-manifest']
  expect(manifest.needs).toContain('verify-gate')
  expect(manifest.if).toContain("needs.verify-gate.result == 'success'")
  for (const name of [
    'backend-plan',
    'prepare-production',
    'build-server',
    'build-discord',
    'build-indexer',
    'build-bot',
  ]) {
    expect(workflow.jobs[name].steps.some(({ run }) => run?.includes('actions/workflows/gate.yml'))).toBe(false)
    expect(workflow.jobs[name].needs).not.toContain('verify-gate')
  }
  const wait = verification.steps[0].run
  expect(wait).toContain('event=push&branch=edge&head_sha=${GITHUB_SHA}')
  expect(wait).toContain('if [ "$conclusion" = "success" ]')
  expect(wait).toContain('if [ -n "$conclusion" ]')
})

for (const conclusion of ['success', 'failure', 'cancelled', ''])
  test(`release certification handles gate conclusion ${conclusion || 'unknown'} without activation`, () => {
    const directory = mkdtempSync(join(tmpdir(), 'ares-gate-certification-'))
    try {
      writeFileSync(join(directory, 'gh'), '#!/bin/sh\nprintf "%s\\n" "$GATE_CONCLUSION"\n', { mode: 0o700 })
      writeFileSync(join(directory, 'sleep'), '#!/bin/sh\nexit 0\n', { mode: 0o700 })
      const run = () =>
        execFileSync('/bin/bash', ['-e', '-c', workflow.jobs['verify-gate'].steps[0].run], {
          env: {
            PATH: `${directory}:/usr/bin:/bin`,
            GATE_CONCLUSION: conclusion,
            GITHUB_SHA: '1'.repeat(40),
            GITHUB_REPOSITORY: 'owner/game',
          },
          stdio: 'pipe',
        })
      if (conclusion === 'success') expect(run().toString()).toContain('gate green')
      else expect(run).toThrow()
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

test('an older release without a bot image builds Discord without rebuilding unchanged game backends', () => {
  const output = run_baseline_plan('mainnet', false)
  expect(output).toContain('discord=true')
  expect(output).toContain('server=false')
  expect(output).toContain('indexer=false')
})

test('backend planning checks out shared locale selectors and supplies the pinned Bun parser', () => {
  const { steps } = workflow.jobs['backend-plan']
  const checkout = steps.find(({ uses }) => uses?.startsWith('actions/checkout@'))
  expect(checkout.with['sparse-checkout']).toContain('packages/immutable')
  const parser = steps.find(({ uses }) => uses?.startsWith('oven-sh/setup-bun@'))
  expect(parser.with['bun-version-file']).toBe('package.json')
  expect(steps.indexOf(parser)).toBeLessThan(steps.findIndex(({ id }) => id === 'plan'))
})

test('legacy preparation without hosted bot rebuilds only the missing artifact', () => {
  const output = run_baseline_plan('mainnet', true, false)
  expect(output).toContain('bot=true')
  for (const component of ['server', 'indexer', 'discord']) expect(output).toContain(`${component}=false`)
})

test('hosted bot certification includes the image and activation requires it', () => {
  const manifest = workflow.jobs['release-manifest']
  expect(manifest.needs).toContain('build-bot')
  expect(manifest.if).toContain("needs.build-bot.result == 'success'")
  const write = manifest.steps.find(({ name }) => name === 'write immutable release manifest')
  expect(write.run).toBe('bash scripts/release_manifest.sh')
  expect(manifest_script).toContain('schema: 2')
  expect(write.env.BOT_DIGEST).toBe('${{ needs.build-bot.outputs.digest }}')
  expect(manifest_script).toContain('repository: "ghcr.io/aresrpg/bot"')
  const verify = activation.jobs.activate.steps.find(({ id }) => id === 'manifest')
  expect(verify.run).toContain('.schema == 2')
  expect(verify.run).toContain('for image in server indexer discord bot; do')
})

test('both Redis test lanes use the same fixture setup without Ubuntu package mirrors', () => {
  const gate = Bun.YAML.parse(readFileSync(new URL('../../.github/workflows/gate.yml', import.meta.url), 'utf8'))
  for (const lane of ['source', 'tests_indexer']) {
    const { steps } = gate.jobs[lane]
    expect(steps.some(({ run }) => /apt-get.*redis-server/.test(run ?? ''))).toBe(false)
    expect(steps.find(({ uses }) => uses === './.github/actions/setup-redis')).toBeDefined()
  }
  const checkout = gate.jobs.tests_indexer.steps.find(({ uses }) => uses?.startsWith('actions/checkout@'))
  expect(checkout.with['sparse-checkout']).toContain('.github/actions/setup-redis')
})

test('CI runs durable bot tests against an explicit disposable loopback fixture', () => {
  const gate = Bun.YAML.parse(readFileSync(new URL('../../.github/workflows/gate.yml', import.meta.url), 'utf8'))
  const verify = gate.jobs.source.steps.find(({ name }) => name === 'verify')
  expect(verify.env.TEST_BOT_REDIS_URL).toBe('redis://127.0.0.1:16379/15')
  expect(verify.run).toContain('redis-server')
  expect(verify.run).toContain('trap ')
  expect(verify.run).toContain('redis-cli')
})

test('the prepared schema2 manifest survives activation checks and rejects a missing or foreign bot', () => {
  const directory = mkdtempSync(join(tmpdir(), 'ares-manifest-activation-'))
  const version = '2.0.0'
  const sha = '1'.repeat(40)
  const verify = activation.jobs.activate.steps.find(({ id }) => id === 'manifest')
  const script = verify.run
    .replaceAll('${{ steps.release.outputs.source_sha }}', sha)
    .replaceAll('${{ steps.release.outputs.version }}', version)
  const environment = {
    PATH: `${directory}:${process.env.PATH}`,
    RUNNER_TEMP: directory,
    GITHUB_STEP_SUMMARY: join(directory, 'summary'),
    GITHUB_OUTPUT: join(directory, 'output'),
    GITHUB_SHA: sha,
    SUI_NETWORK: 'mainnet',
    VERSION: version,
    PREVIOUS_TAG: 'v1.0.0',
    VERCEL_URL: '',
    FRONTEND_BUILT: 'false',
    ...Object.fromEntries(
      ['BOT', 'SERVER', 'INDEXER', 'DISCORD'].flatMap((name) => [
        [`${name}_DIGEST`, certified_digest],
        [`${name}_BUILT`, 'true'],
      ])
    ),
  }
  try {
    writeFileSync(
      join(directory, 'pins.json'),
      JSON.stringify({
        network: 'mainnet',
        ...Object.fromEntries(
          ['math_', 'control_', 'combat_', 'seed_', ''].flatMap((prefix) => [
            [`${prefix}package`, '0x1'],
            [`${prefix}package_original`, '0x1'],
          ])
        ),
      })
    )
    writeFileSync(join(directory, 'docker'), '#!/bin/sh\nexit 0\n', { mode: 0o700 })
    execFileSync('/bin/bash', ['-e', '-c', manifest_script], { cwd: directory, env: environment, stdio: 'pipe' })
    expect(() =>
      execFileSync('/bin/bash', ['-e', '-c', manifest_script], {
        cwd: directory,
        env: { ...environment, BOT_DIGEST: '' },
        stdio: 'pipe',
      })
    ).toThrow()
    execFileSync('/bin/bash', ['-e', '-c', manifest_script], { cwd: directory, env: environment, stdio: 'pipe' })
    const path = join(directory, 'production-release/release-manifest.json')
    const manifest = JSON.parse(readFileSync(path, 'utf8'))
    expect(manifest.schema).toBe(2)
    expect(manifest.images.bot).toEqual({
      repository: 'ghcr.io/aresrpg/bot',
      version,
      digest: certified_digest,
      built: true,
    })
    const activate = () => execFileSync('/bin/bash', ['-e', '-c', script], { env: environment, stdio: 'pipe' })
    activate()
    expect(readFileSync(environment.GITHUB_OUTPUT, 'utf8')).toContain('frontend=false')
    for (const invalid of [
      { ...manifest, schema: 1 },
      { ...manifest, source_sha: '2'.repeat(40) },
      { ...manifest, images: { ...manifest.images, bot: null } },
      { ...manifest, images: { ...manifest.images, bot: { ...manifest.images.bot, digest: 'latest' } } },
      {
        ...manifest,
        images: { ...manifest.images, bot: { ...manifest.images.bot, repository: 'ghcr.io/foreign/bot' } },
      },
    ]) {
      writeFileSync(path, JSON.stringify(invalid))
      expect(activate).toThrow()
    }
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('release jobs check out their shared immutable artifact scripts', () => {
  for (const name of ['server', 'indexer', 'discord', 'bot']) {
    const checkout = workflow.jobs[`build-${name}`].steps.find(({ uses }) => uses?.startsWith('actions/checkout@'))
    const paths = checkout.with['sparse-checkout']
    expect(paths.includes('/*') || paths.includes('scripts/release_image.sh')).toBe(true)
  }
  const checkout = workflow.jobs['release-manifest'].steps.find(({ uses }) => uses?.startsWith('actions/checkout@'))
  expect(checkout.with['sparse-checkout']).toContain('scripts/release_manifest.sh')
  expect(checkout.with['sparse-checkout']).toContain('pins.json')
})
