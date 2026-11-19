// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { MarketDisclaimer } from '@aresrpg/ui'
import { Gamepad2, ShieldCheck, TrendingDown } from 'lucide-react'

const notice_rows = Object.freeze([
  Object.freeze({ key: 'disclaimer_supply', Icon: TrendingDown, color: '#ef9a5a' }),
  Object.freeze({ key: 'disclaimer_fun', Icon: Gamepad2, color: '#67adff' }),
  Object.freeze({ key: 'disclaimer_wallet', Icon: ShieldCheck, color: '#65c993' }),
])

export const MarketplaceDisclaimer = ({
  text,
  acknowledge,
}: Readonly<{ text: (key: string) => string; acknowledge: () => void }>) => (
  <MarketDisclaimer
    labels={{
      kicker: text('disclaimer_kicker'),
      title: text('disclaimer_title'),
      body: text('disclaimer_body'),
      acknowledge: text('disclaimer_acknowledge'),
    }}
    notices={notice_rows.map((row) => ({ ...row, text: text(row.key) }))}
    acknowledge={acknowledge}
  />
)
