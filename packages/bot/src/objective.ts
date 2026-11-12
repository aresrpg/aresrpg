// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { nonempty, object_schema, type Schema } from './gameplay_schema.ts'

/** Optional display metadata travels with the accepted run and its idempotency fingerprint. */
export const OBJECTIVE_SCHEMA: Schema = {
  ...object_schema({ title: nonempty, description: nonempty, steps: { type: 'array', items: nonempty } }),
  required: ['title'],
}
