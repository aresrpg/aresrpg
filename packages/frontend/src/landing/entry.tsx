// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Integration controller: the presentation and choreography remain Opus-authored.
import { createRoot } from 'react-dom/client'
import { useEffect, useReducer, type ComponentType } from 'react'
import '@aresrpg/ui/styles.css'

import { agent_connect_url } from '../agents/entry_intent.ts'
import { show_boot_loading, show_boot_failure } from '../boot_loading.ts'
import { env } from '../env.ts'
import { load_app_copy, type AppCopy } from '../i18n/copy.ts'
import { LocaleScope } from '../i18n/LocaleScope.tsx'
import { load_locale } from '../i18n/locale.ts'
import type { KaresCopy } from '../kares/copy.ts'
import { react_error_handlers, report_error } from '../reporting.ts'
import { finish_startup_recovery, observe_startup_recovery } from '../startup_recovery.ts'

import { Landing } from './Landing.tsx'
import { landing_assets } from './assets.ts'
import { landing_links } from './presentation.ts'
import type { LandingCopy } from './landing_types.ts'

type TokenomicsView = ComponentType<Readonly<{ copy: KaresCopy }>>
type Resource = Readonly<{ kind: 'loading' } | { kind: 'ready'; View: TokenomicsView } | { kind: 'failed' }>
const receive_resource = (_state: Resource, input: Resource): Resource => input

/** The shared finance code and its read lifecycle start only while the dialog is mounted. */
const TokenomicsContent = ({ copy }: Readonly<{ copy: AppCopy }>) => {
  const [resource, dispatch] = useReducer(receive_resource, { kind: 'loading' })
  useEffect(() => {
    let active = true
    void import('../kares/TokenomicsPanel.tsx')
      .then(({ Tokenomics }) => {
        if (active) dispatch({ kind: 'ready', View: Tokenomics })
      })
      .catch((error: unknown) => {
        report_error(error, { area: 'tokenomics_chunk' })
        if (active) dispatch({ kind: 'failed' })
      })
    return () => {
      active = false
    }
  }, [])
  switch (resource.kind) {
    case 'ready':
      return <resource.View copy={copy.kares_page} />
    case 'failed':
      return (
        <div role="alert">
          <p>{copy.kares_page.figures_unavailable}</p>
          <button type="button" onClick={() => location.reload()}>
            {copy.engine_reload}
          </button>
        </div>
      )
    case 'loading':
      return <p role="status">{copy.kares_page.loading}</p>
  }
}

type LandingAppCopy = AppCopy & Readonly<{ landing_page?: LandingCopy }>

export const boot_landing = async (): Promise<void> => {
  const host = document.getElementById('root')
  if (!host) throw new Error('Application root is missing')
  const locale = load_locale()
  const copy = (await load_app_copy(locale)) as LandingAppCopy
  const landing_copy = copy.landing_page ?? ((await load_app_copy('en')) as LandingAppCopy).landing_page
  if (!landing_copy) throw new Error('Canonical landing copy is missing')
  const links = landing_links(location.origin, env.discord_url)
  const root = createRoot(host, react_error_handlers)
  let entering = false
  let ready_frame = 0
  const enter_game = async (): Promise<void> => {
    root.unmount()
    show_boot_loading()
    observe_startup_recovery()
    const { boot_game } = await import('../game_entry.tsx')
    boot_game()
  }
  const play = (): void => {
    if (entering) return
    entering = true
    if (ready_frame) cancelAnimationFrame(ready_frame)
    queueMicrotask(() => {
      void enter_game().catch((error: unknown) => {
        report_error(error, { area: 'landing_play' })
        show_boot_failure()
      })
    })
  }
  root.render(
    <LocaleScope locale={locale}>
      <Landing
        copy={landing_copy}
        assets={landing_assets}
        links={links}
        on_play={play}
        agent_connect_url={agent_connect_url(location.origin)}
        tokenomics={<TokenomicsContent copy={copy} />}
      />
    </LocaleScope>
  )
  ready_frame = requestAnimationFrame(() => {
    ready_frame = 0
    if (!entering) finish_startup_recovery()
  })
}
