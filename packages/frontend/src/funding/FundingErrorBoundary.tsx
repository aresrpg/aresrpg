// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { Component, type ReactNode } from 'react'

type BoundaryProps = Readonly<{ children: ReactNode; fallback: ReactNode; on_error?: () => void }>
export class FundingErrorBoundary extends Component<BoundaryProps, { failed: boolean }> {
  override state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  override componentDidCatch(error: Readonly<Error>) {
    console.error('Optional wallet surface failed', error)
    // eslint-disable-next-line functional/no-this-expressions -- React error boundaries expose callbacks through instance props.
    this.props.on_error?.()
  }
  override render() {
    // eslint-disable-next-line functional/no-this-expressions -- React error boundaries require instance props and state.
    return this.state.failed ? this.props.fallback : this.props.children
  }
}
