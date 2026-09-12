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

const certified_digest = `sha256:${'b'.repeat(64)}`
const moved_tag_digest = `sha256:${'a'.repeat(64)}`

const run_baseline_plan = (network) => {
  const directory = mkdtempSync(join(tmpdir(), 'ares-release-baseline-'))
  const output = join(directory, 'output')
  const plan = workflow.jobs['backend-plan'].steps.find(({ id }) => id === 'plan').run
  const script = `previous_tag=v1.0.0; server=false; indexer=false; frontend=false
server_version=2.0.0; indexer_version=2.0.0; server_digest=''; indexer_digest=''
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
          ['server', 'indexer'].map((name) => [
            name,
            {
              repository: `ghcr.io/aresrpg/${name}`,
              digest: certified_digest,
            },
          ])
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
  for (const component of ['server', 'indexer', 'frontend']) expect(output).toContain(`${component}=true`)
  expect(output).toContain('server_digest=\n')
  expect(output).toContain('indexer_digest=\n')
})

test('a certified mainnet baseline retains the fast path for unchanged runtime inputs', () => {
  const output = run_baseline_plan('mainnet')
  for (const component of ['server', 'indexer', 'frontend']) expect(output).toContain(`${component}=false`)
  expect(output).toContain(`server_digest=${certified_digest}`)
  expect(output).toContain(`indexer_digest=${certified_digest}`)
})

const run_image_step = (component, step_id, current_digest) => {
  const directory = mkdtempSync(join(tmpdir(), 'ares-image-identity-'))
  const output = join(directory, 'output')
  const calls = join(directory, 'calls')
  const digest_file = join(directory, 'digest')
  const values = {
    'github.repository_owner': 'aresrpg',
    [`needs.backend-plan.outputs.${component}`]: 'false',
    [`needs.backend-plan.outputs.${component}_version`]: '2.0.0',
    [`needs.backend-plan.outputs.${component}_digest`]: certified_digest,
    'needs.backend-plan.outputs.previous_tag': 'v1.0.0',
  }
  const step = workflow.jobs[`build-${component}`].steps.find(({ id }) => id === step_id)
  const script = step.run.replace(/\$\{\{\s*([^}]+?)\s*\}\}/g, (_, expression) => {
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
    execFileSync('/bin/bash', ['-e', '-c', script], {
      env: {
        PATH: `${directory}:/usr/bin:/bin`,
        GITHUB_OUTPUT: output,
        GITHUB_SHA: '1'.repeat(40),
        IMAGE_REPOSITORY: `ghcr.io/aresrpg/${component}`,
        EXPECTED_DIGEST: certified_digest,
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

for (const component of ['server', 'indexer']) {
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
    { ...manifest, schema: 2 },
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
  for (const name of ['backend-plan', 'prepare-production', 'build-server', 'build-indexer']) {
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
