// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { SUI_LOGO_PATH } from '@aresrpg/ui/sui'

/** Official droplet geometry shared by game prices and the public sale. */
export const SuiLogo = ({ size = 16 }: Readonly<{ size?: number }>) => (
  <svg aria-hidden="true" data-sui-logo height={size} viewBox="0 0 24 24" width={size}>
    <path d={SUI_LOGO_PATH} fill="currentColor" />
  </svg>
)
