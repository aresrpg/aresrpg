// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { ReactNode } from 'react'

import { fight_access_from } from '../game/core/settings.ts'
import type { AppCopy } from '../i18n/copy.ts'
import { dispatch_app, useAppStore } from '../store.ts'

import '../game/hud/world_chrome.css'
import { FpsPanel } from './FpsPanel.tsx'

export const WorldStatus = ({
  copy,
  party_available,
  active = true,
  children,
}: Readonly<{ copy: AppCopy; party_available: boolean; active?: boolean; children: ReactNode }>) => {
  const settings = useAppStore((state) => state.settings)
  const access = fight_access_from(settings.fight_access)
  return (
    <div className="world-status flex w-fit flex-col items-start gap-2">
      <FpsPanel
        active={active}
        copy={copy}
        quality={settings.quality}
        fight_access={party_available ? access : null}
        party_available={party_available}
        change_quality={(quality) => dispatch_app({ type: 'settings/changed', settings: { ...settings, quality } })}
        toggle_fight_access={() =>
          dispatch_app({ type: 'settings/changed', settings: { ...settings, fight_access: access === 0 ? 1 : 0 } })
        }
      />
      {children}
    </div>
  )
}
