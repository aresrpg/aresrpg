// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import kares_logo from '../../../launchpad/public/kares.png'

export const KaresLogo = ({ size = 16 }: Readonly<{ size?: number }>) => (
  <img alt="" className="shrink-0" data-kares-logo height={size} src={kares_logo} width={size} />
)
