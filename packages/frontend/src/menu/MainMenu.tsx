// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { CornerDownLeft, Volume2, VolumeX } from 'lucide-react'
import { useEffect, type ReactNode } from 'react'

import { version } from '../../../../package.json'
import { FpsPanel } from '../components/FpsPanel.tsx'
import { music } from '../../../../seed/scenes/main_menu.recipe.json'
import title_logo from '../../../../seed/scenes/aresrpg_text_logo.png'
import { MusicBed } from '../game/audio/MusicBed.tsx'
import type { AppCopy } from '../i18n/copy.ts'
import { dispatch_app, useAppStore } from '../store.ts'

import { MenuScene } from './MenuScene.tsx'
import './main_menu.css'

export const MainMenu = ({
  copy,
  first_visit,
  children,
}: Readonly<{ copy: AppCopy; first_visit: boolean; children: ReactNode }>) => {
  const settings = useAppStore((state) => state.settings)
  useEffect(() => {
    if (!first_visit) return
    const start = (event: Readonly<KeyboardEvent>): void => {
      if (event.key !== 'Enter' || event.repeat || event.defaultPrevented) return
      if (
        event.target instanceof HTMLElement &&
        event.target.closest('a,button,input,textarea,select,[contenteditable]')
      )
        return
      event.preventDefault()
      globalThis.location.assign('/play-demo')
    }
    globalThis.addEventListener('keydown', start)
    return () => globalThis.removeEventListener('keydown', start)
  }, [first_visit])
  return (
    <section className="main-menu" data-main-menu>
      <MenuScene />
      <div className="main-menu-performance">
        <FpsPanel
          active
          quality={settings.quality}
          fight_access={null}
          party_available={false}
          copy={copy}
          change_quality={(quality) => dispatch_app({ type: 'settings/changed', settings: { ...settings, quality } })}
        />
      </div>
      <span className="main-menu-build">
        {copy.menu_build} <b>v{version}</b>
      </span>
      <MusicBed url={music} />
      <div className="main-menu-shade" aria-hidden="true" />
      <button
        className="main-menu-music"
        type="button"
        aria-label={settings.music_enabled ? copy.menu_music_off : copy.menu_music_on}
        aria-pressed={settings.music_enabled}
        onClick={() =>
          dispatch_app({ type: 'settings/changed', settings: { ...settings, music_enabled: !settings.music_enabled } })
        }
      >
        {settings.music_enabled ? <Volume2 size={19} /> : <VolumeX size={19} />}
      </button>
      <div className="main-menu-content">
        <header className="main-menu-heading">
          <h1>
            <img src={title_logo} alt="AresRPG" width={2169} height={725} />
          </h1>
          <p>{copy.menu_subtitle}</p>
        </header>
        {first_visit ? (
          <a className="main-menu-start" href="/play-demo">
            <span className="menu-keyboard-start">{copy.menu_start}</span>
            <span className="menu-touch-start">{copy.menu_start_touch}</span>
            <CornerDownLeft size={18} aria-hidden="true" />
          </a>
        ) : (
          children
        )}
      </div>
    </section>
  )
}
