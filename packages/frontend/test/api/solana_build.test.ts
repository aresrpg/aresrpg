// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { expect, test } from 'bun:test'
import ts from 'typescript'

test('the emitted Solana function loads in Node without TypeScript source files', () => {
  const root = fileURLToPath(new URL('../../', import.meta.url))
  const config = ts.readConfigFile(join(root, 'tsconfig.json'), ts.sys.readFile)
  const { options } = ts.parseJsonConfigFileContent(config.config, ts.sys, root)
  const output = mkdtempSync(join(tmpdir(), 'aresrpg-solana-function-'))
  try {
    writeFileSync(join(output, 'package.json'), JSON.stringify({ type: 'module' }))
    // Vercel's Node builder transpiles these modules separately and ships their .js outputs.
    for (const path of ['api/solana.ts', 'server/solana_rpc.ts', 'src/funding/solana_rpc_contract.ts']) {
      const compiled = ts.transpileModule(readFileSync(join(root, path), 'utf8'), {
        fileName: path,
        compilerOptions: options,
      })
      const destination = join(output, path.replace(/\.ts$/, '.js'))
      mkdirSync(dirname(destination), { recursive: true })
      writeFileSync(destination, compiled.outputText)
    }
    const result = execFileSync(
      'node',
      [
        '--input-type=module',
        '-e',
        `
      import endpoint from './api/solana.js';
      const method = await endpoint.fetch(new Request('https://aresrpg.world/api/solana'));
      const origin = await endpoint.fetch(new Request('https://aresrpg.world/api/solana', {method: 'POST'}));
      console.log(JSON.stringify([method.status, origin.status]));
    `,
      ],
      { cwd: output, encoding: 'utf8' }
    )
    expect(JSON.parse(result)).toEqual([405, 403])
  } finally {
    rmSync(output, { recursive: true, force: true })
  }
})
