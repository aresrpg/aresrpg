// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const output = resolve(root, process.argv[2] ?? 'packages/frontend/public/agents/ares-agent.mjs')
const result = await Bun.build({
  entrypoints: [resolve(root, 'packages/sdk/examples/agent_cli.ts')],
  target: 'node',
  format: 'esm',
  minify: true,
})
if (!result.success) throw new AggregateError(result.logs, 'Agent CLI build failed')
await mkdir(dirname(output), { recursive: true })
await writeFile(output, await result.outputs[0]!.text())
console.log(`Agent CLI: ${result.outputs[0]!.size} bytes`)
