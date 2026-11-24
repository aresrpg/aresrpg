// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { useId } from 'react'

import { SUI_LOGO_PATH } from '../sui.ts'

/** The official Sui droplet: always the brand blue with a light upper edge, whatever the text colour around it. */
export const SuiLogo = ({ size = 16 }: Readonly<{ size?: number }>) => {
  const shine = useId()
  return (
    <svg aria-hidden="true" className="sui-logo" data-sui-logo height={size} viewBox="0 0 24 24" width={size}>
      <defs>
        <linearGradient id={shine} x1="0" x2="1" y1="0" y2="1">
          <stop className="sui-logo-light" offset="0" />
          <stop className="sui-logo-blue" offset="0.55" />
          <stop className="sui-logo-deep" offset="1" />
        </linearGradient>
      </defs>
      <path d={SUI_LOGO_PATH} fill={`url(#${shine})`} />
    </svg>
  )
}
