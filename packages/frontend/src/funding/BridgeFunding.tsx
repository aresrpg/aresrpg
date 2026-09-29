// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { Component, lazy, Suspense, useState, type ReactNode } from 'react'

import { copy_text, type AppCopy } from '../i18n/copy.ts'

type BoundaryProps = Readonly<{ children: ReactNode; fallback: ReactNode }>
export class FundingErrorBoundary extends Component<BoundaryProps, { failed: boolean }> {
  override state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  override render() {
    // eslint-disable-next-line functional/no-this-expressions -- React error boundaries require instance props and state.
    return this.state.failed ? this.props.fallback : this.props.children
  }
}

export const BridgeFunding = ({ address, copy }: Readonly<{ address: string; copy: AppCopy }>) => {
  const text = copy_text(copy.wallet_legacy)
  const [view, set_view] = useState(() => ({
    key: 0,
    Widget: lazy(() => import('./BridgeWidget.tsx')),
  }))
  return (
    <div className="space-y-3" data-bridge-funding="">
      <p className="text-xs leading-relaxed text-muted">{text('steps_swap')}</p>
      <div
        className="break-all border border-border bg-bg/50 p-3 font-mono text-[11px] text-gold"
        data-bridge-recipient=""
      >
        {address}
      </div>
      <FundingErrorBoundary
        key={view.key}
        fallback={
          <div className="space-y-3 p-4 text-xs" role="alert">
            <p>{text('bridge_error')}</p>
            <button
              className="btn-outline p-3"
              type="button"
              onClick={() =>
                set_view(({ key }) => ({ key: key + 1, Widget: lazy(() => import('./BridgeWidget.tsx')) }))
              }
            >
              {text('bridge_retry')}
            </button>
          </div>
        }
      >
        <Suspense
          fallback={
            <p className="p-6 text-center text-xs text-muted" role="status">
              {text('bridge_loading')}
            </p>
          }
        >
          <view.Widget address={address} />
        </Suspense>
      </FundingErrorBoundary>
      <p className="text-[10px] leading-relaxed text-muted">{text('swap_note')}</p>
    </div>
  )
}
