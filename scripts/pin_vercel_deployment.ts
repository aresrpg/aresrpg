// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { readFile, writeFile } from 'node:fs/promises'

import { with_bot_csp } from '../packages/frontend/deployment_csp.ts'
import { validate_deployment_id } from '../packages/frontend/deployment_assets.ts'

// The Vite build and Vercel's prebuilt output must agree on the same custom deployment ID.
const id = validate_deployment_id(process.env.ARES_DEPLOYMENT_ID ?? '')
const path = '.vercel/output/config.json'
const config = JSON.parse(await readFile(path, 'utf8'))
if (config.version !== 3) throw new Error('Expected Vercel Build Output API version 3')
await writeFile(
  path,
  `${JSON.stringify({ ...with_bot_csp(config, process.env.VITE_BOT_SERVICE_URL), deploymentId: id }, null, 2)}\n`
)
