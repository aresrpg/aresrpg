// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { copyFile, mkdir } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { CITY_DEFINITIONS } from '../engine/src/cities/registry.ts'

const root = fileURLToPath(new URL('../../', import.meta.url))
const directory = resolve(process.argv[2] ?? resolve(root, '.dev/bot'))
const result = await Bun.build({
  entrypoints: [resolve(root, 'packages/bot/src/index.ts')],
  target: 'bun',
  outdir: directory,
  naming: 'bot.js',
})
if (!result.success) throw new AggregateError(result.logs, 'Bot bundle failed')
// Bun retains import.meta.url relative to the bundle; collision loads occupancy lazily.
await mkdir(resolve(directory, 'generated'), { recursive: true })
await Promise.all(
  CITY_DEFINITIONS.map(({ artifact_url }) =>
    copyFile(artifact_url, resolve(directory, 'generated', basename(artifact_url.pathname)))
  )
)
