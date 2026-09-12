// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { item_icon } from '../content/assets.ts'

export const JobItemIcon = ({ icon, size = 28 }: Readonly<{ icon: string; size?: number }>) => {
  const url = item_icon(icon)
  if (!url)
    return (
      <span aria-hidden="true" className="jobs__item-glyph" style={{ width: size, height: size }}>
        <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path d="M12 3 21 12 12 21 3 12Z" strokeLinejoin="round" strokeWidth="1.6" />
        </svg>
      </span>
    )
  return <img alt="" className="jobs__item-img" height={size} loading="lazy" src={url} width={size} />
}
