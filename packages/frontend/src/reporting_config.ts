// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { DEFAULT_NETWORK } from '@aresrpg/sdk/pins'

export const reporting_config = (source: Readonly<Record<string, string | undefined>>) => ({
  dsn: source.VITE_SENTRY_DSN || undefined,
  enabled: source.MODE === 'production' && Boolean(source.VITE_SENTRY_DSN),
  environment: `${source.VITE_NETWORK ?? DEFAULT_NETWORK}-${source.VITE_DEPLOY_ENV ?? 'local'}`,
  release: source.VITE_RELEASE || undefined,
})

/** A deployed build without a destination would silently discard every captured error. */
export const require_reporting_dsn = (source: Readonly<Record<string, string | undefined>>): void => {
  if (source.VERCEL_ENV && !source.VITE_SENTRY_DSN)
    throw new Error(`VITE_SENTRY_DSN is required for the ${source.VERCEL_ENV} deployment`)
}
