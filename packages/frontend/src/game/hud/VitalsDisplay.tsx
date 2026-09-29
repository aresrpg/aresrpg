// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { useText } from '../../i18n/useText.ts'

import { useState } from 'react'
import { Vitals } from '@aresrpg/ui'

export const vital_percent = (value: bigint, maximum: bigint): number =>
  maximum <= 0n ? 0 : Math.max(0, Math.min(100, Number((value * 10_000n) / maximum) / 100))

export const VitalsDisplay = ({
  hp,
  max_hp,
  ap,
  mp,
}: Readonly<{ hp: bigint; max_hp: bigint; ap: bigint; mp: bigint }>) => {
  const ui = useText()
  const [percent_visible, set_percent_visible] = useState(false)
  return (
    <Vitals
      health={percent_visible ? `${Math.round(vital_percent(hp, max_hp))}%` : hp.toString()}
      fill={vital_percent(hp, max_hp)}
      health_label={ui('ui.vitals', { current: String(hp), maximum: String(max_hp), unit: ui('ui.hp') })}
      on_health={() => set_percent_visible(!percent_visible)}
      ap={String(ap)}
      mp={String(mp)}
      ap_label={`${ui('fight_hud.unit_ap')} ${ap}`}
      mp_label={`${ui('fight_hud.unit_mp')} ${mp}`}
    />
  )
}
