// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { lazy, Suspense } from 'react'
import { initial_finance, initial_wallet_state } from '@aresrpg/frontend/finance'

import { Atmosphere } from './Atmosphere.tsx'
import { LaunchView, type LaunchViewProps } from './LaunchView.tsx'

const LaunchController = lazy(() => import('./LaunchController.tsx'))

export const LaunchPage = (props: Omit<LaunchViewProps, 'state' | 'dispatch' | 'wallet'>) => (
  <>
    <Atmosphere />
    <Suspense
      fallback={
        <LaunchView
          {...props}
          wallet={{ state: initial_wallet_state(), dispatch: () => undefined }}
          dispatch={() => undefined}
          state={{ ...initial_finance(), request: { kind: 'refresh' } }}
        />
      }
    >
      <LaunchController {...props} />
    </Suspense>
  </>
)
