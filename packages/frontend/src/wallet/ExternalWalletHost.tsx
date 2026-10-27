// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { lazy, Suspense } from 'react'

import { env } from '../env.ts'
import { useAppStore, dispatch_app } from '../store.ts'
import { FundingErrorBoundary } from '../funding/FundingErrorBoundary.tsx'

const PrivyConnector = lazy(() => import('./PrivyConnector.tsx'))

export const ExternalWalletHost = () => {
  const enabled = useAppStore((state) => state.external_wallet.connector_enabled)
  return enabled && env.privy_app_id ? (
    <FundingErrorBoundary fallback={null} on_error={() => dispatch_app({ type: 'external_wallet/connector_failed' })}>
      <Suspense fallback={null}>
        <PrivyConnector />
      </Suspense>
    </FundingErrorBoundary>
  ) : null
}
