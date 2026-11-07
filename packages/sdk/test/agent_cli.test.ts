// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

import { expect, test } from 'bun:test'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { toZkLoginPublicIdentifier } from '@mysten/sui/zklogin'

import { initialize_agent } from '../examples/agent_host.ts'
import { verify_agent_pairing } from '../src/agent_pairing.ts'

const run_cli = async (file: string, command: string, directory: string, input?: string) => {
  const child = Bun.spawn(['node', file, command, directory], {
    cwd: dirname(file),
    env: { PATH: process.env.PATH, ARESRPG_LOCAL_PREVIEW: '1' },
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'pipe',
  })
  child.stdin.write(input ?? '')
  child.stdin.end()
  const [code, output, error] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ])
  return { code, output, error }
}

test('downloaded standalone Node client posts verified persistent proof and survives a fresh process', async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'ares-agent-cli-fixture-')))
  const google = toZkLoginPublicIdentifier(1n, 'https://accounts.google.com', { legacyAddress: false })
  const request = {
    version: 1 as const,
    nonce: '11111111-1111-4111-8111-111111111111',
    network: 'mainnet' as const,
    owner: google.toSuiAddress(),
    zklogin_public_identifier: google.toBase64(),
  }
  const built = await Bun.build({
    entrypoints: [resolve(import.meta.dir, '../examples/agent_cli.ts')],
    target: 'node',
    format: 'esm',
    minify: true,
  })
  expect(built.success).toBe(true)
  let proof_address = ''
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: async (incoming) => {
      const url = new URL(incoming.url)
      if (url.pathname === '/ares-agent.mjs') return new Response(built.outputs[0])
      expect(url.hash).toBe('')
      expect(incoming.headers.get('authorization')).toBe(`Bearer ${'a'.repeat(43)}`)
      if (incoming.method === 'GET') return Response.json(request)
      const proof = await incoming.json()
      expect(proof.signer_mode).toBe('host-persistent')
      const result = await verify_agent_pairing(request, proof)
      proof_address = result.address
      return Response.json(result)
    },
  })
  try {
    // A known synthetic fixture replaces key generation. This is not a user credential.
    const started = performance.now()
    await initialize_agent(directory, true, () => Ed25519Keypair.fromSecretKey(new Uint8Array(32).fill(9)))
    const download = await fetch(`${server.url}ares-agent.mjs`)
    const executable = join(directory, 'ares-agent.mjs')
    await writeFile(executable, await download.text())
    const link = `${server.url}api/agent-setup?id=${request.nonce}#${'a'.repeat(43)}`
    const paired = await run_cli(executable, 'pair', directory, link)
    expect(paired.error).toBe('')
    expect(paired.code).toBe(0)
    expect(JSON.parse(paired.output)).toEqual({ status: 'paired', address: proof_address })
    const loaded = await run_cli(executable, 'reload', directory)
    expect(loaded.code).toBe(0)
    expect(JSON.parse(loaded.output).address).toBe(proof_address)
    const invalid = await run_cli(executable, 'pair', join(directory, 'absent'), link)
    expect(invalid.code).toBe(1)
    expect(invalid.output + invalid.error).not.toContain('a'.repeat(43))
    expect(paired.output + paired.error).not.toContain('signature')
    console.log(
      JSON.stringify({
        verification: 'local synthetic exchange, clean standalone Node process',
        elapsed_ms: Math.round(performance.now() - started),
        bundle_bytes: built.outputs[0]!.size,
      })
    )
  } finally {
    server.stop(true)
    await rm(directory, { recursive: true, force: true })
  }
})
