// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { relative } from 'node:path'

import pino from 'pino'

const root = pino({ level: process.env.LOG_LEVEL || 'info' })

/** Per-module child logger, tagged by file: `logger(import.meta)`. */
export default (meta: ImportMeta) => root.child({ name: relative(process.cwd(), new URL(meta.url).pathname) })
