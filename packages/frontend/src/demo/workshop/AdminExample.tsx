// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { useState } from 'react'
import type { AdminOverviewResult } from '@aresrpg/protocol'
import { Workspace } from '@aresrpg/ui'
import { Shield } from 'lucide-react'

import { OverviewPageView } from '../../admin/OverviewPage.tsx'
import { initial_admin_state } from '../../admin/admin_state.ts'
import type { AppCopy } from '../../i18n/copy.ts'

import { WorkshopSurface } from './shared.tsx'
const values = [3, 5, 4, 8, 11, 7, 8, 12, 9, 15, 13, 19]
const at = (index: number) => Date.UTC(2026, 8, index + 1)
const result: AdminOverviewResult = {
  as_of_checkpoint: 123456789,
  as_of_ms: Date.UTC(2026, 8, 27),
  revenue: {
    days: 30,
    bucket: 'day',
    item_royalty_mist: '45210000000',
    character_royalty_mist: '18600000000',
    character_creation_mist: '15930000000',
    kolizeum_mist: '13800000000',
    last_30d_revenue_mist: '93540000000',
    month_to_date_revenue_mist: '93540000000',
    all_time_revenue_mist: '452130000000',
    money: values.map((n, i) => ({
      at_ms: at(i),
      item_royalty_mist: String(n * 100000000),
      character_royalty_mist: String(n * 40000000),
      character_creation_mist: String(n * 80000000),
      kolizeum_mist: String(n * 20000000),
    })),
  },
  players: {
    days: 30,
    bucket: 'day',
    dau: 128,
    rolling_30d: 842,
    activity: values.map((n, i) => ({ at_ms: at(i), active: n * 10 })),
  },
  transactions: {
    days: 30,
    bucket: 'day',
    total: 75381,
    last_24h: 1280,
    last_30d: 75381,
    all_time: 230913,
    gas_range_mist: '854000000',
    gas_last_24h_mist: '23000000',
    gas_last_30d_mist: '854000000',
    gas_all_time_mist: '3120000000',
    transactions: values.map((n, i) => ({ at_ms: at(i), transactions: n * 103 })),
  },
  online: { days: 1, bucket: 'hour', online_peak: 192, online: values.map((n, i) => ({ at_ms: at(i), peak: n * 10 })) },
  addresses: {
    days: 30,
    bucket: 'day',
    total: 843,
    addresses: values.map((n, i) => ({ at_ms: at(i), total: n * 30 })),
  },
  characters: {
    days: 30,
    bucket: 'day',
    total: 1296,
    characters: values.map((n, i) => ({ at_ms: at(i), total: n * 50 })),
  },
}
export const AdminExample = ({ copy }: Readonly<{ copy: AppCopy }>) => {
  const [overview, set_overview] = useState({ ...initial_admin_state().overview, result, status: 'ready' as const })
  const [notice, set_notice] = useState(false)
  return (
    <WorkshopSurface copy={copy} title={copy.admin} icon={<Shield />}>
      {(header) => (
        <Workspace {...header} className="aui-feature-port aui-admin-port">
          <OverviewPageView
            copy={copy.admin_page as Record<string, string>}
            overview={overview}
            online_count={128}
            revenue_wallet={{
              royalties: [],
              treasury_mist: 168420000000n,
              claimable: 3600000000n,
              reading: false,
              claiming: false,
              claim_blocked: false,
              connected: true,
              error: null,
              refresh: () => set_notice(true),
              claim: () => set_notice(true),
            }}
            dispatch={(input) => {
              if (input.type === 'admin/overview_range_changed')
                set_overview({ ...overview, ranges: { ...overview.ranges, [input.section]: input.days } })
            }}
          />
          {notice && <p role="status">{copy.ui.preview_only}</p>}
        </Workspace>
      )}
    </WorkshopSurface>
  )
}
