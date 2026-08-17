// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { Music2, Settings as SettingsIcon } from 'lucide-react'

import type { GameSettings } from '../game/core/settings.ts'
import { copy_text, type AppCopy } from '../i18n/copy.ts'
import { dispatch_app } from '../store.ts'

const Toggle = ({
  checked,
  label,
  change,
}: Readonly<{ checked: boolean; label: string; change: (checked: boolean) => void }>) => (
  <button
    aria-checked={checked}
    aria-label={label}
    className={`relative h-6 w-11 shrink-0 cursor-pointer border transition-colors ${checked ? 'border-gold bg-gold/15' : 'border-white/15 bg-white/3'}`}
    onClick={() => change(!checked)}
    role="switch"
    type="button"
  >
    <span
      className={`absolute top-0.5 size-[18px] transition-all ${checked ? 'left-[21px] bg-gold shadow-[0_0_7px_rgba(200,150,60,0.6)]' : 'left-0.5 bg-muted'}`}
    />
  </button>
)

export default function SettingsPage({ copy, settings }: Readonly<{ copy: AppCopy; settings: GameSettings }>) {
  const t = copy_text(copy.settings_page)
  const change_music = (music_enabled: boolean): void =>
    dispatch_app({ type: 'settings/changed', settings: Object.freeze({ ...settings, music_enabled }) })

  return (
    <section className="pointer-events-auto min-h-full flex-1 overflow-y-auto border border-border bg-[#0a0a0f]/97 p-3 lg:p-8">
      <header className="mb-4 flex items-center gap-2.5 lg:mb-8">
        <SettingsIcon className="text-gold opacity-60" size={14} />
        <div>
          <h1 className="bg-[linear-gradient(135deg,#f5d0a9,#c8963c,#f0c474)] bg-clip-text text-[13px] font-semibold tracking-[0.3em] text-transparent uppercase">
            {t('title')}
          </h1>
          <p className="mt-1 text-[10px] tracking-wide text-muted">{t('subtitle')}</p>
        </div>
      </header>

      <div className="mt-4 flex max-w-lg items-center justify-between gap-5 border border-border bg-surface/80 p-4 lg:mt-8 lg:p-5">
        <div className="flex min-w-0 items-center gap-3">
          <Music2 className="shrink-0 text-gold opacity-70" size={15} />
          <div className="min-w-0">
            <div className="text-[11px] tracking-wide text-text">{t('music_label')}</div>
            <div className="mt-1 text-[9px] leading-5 tracking-wide text-muted">{t('music_hint')}</div>
          </div>
        </div>
        <Toggle change={change_music} checked={settings.music_enabled} label={t('music_label')} />
      </div>
    </section>
  )
}
