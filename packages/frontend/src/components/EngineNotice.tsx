// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { EngineStatus } from '@aresrpg/engine'

import type { AppCopy } from '../i18n/copy.ts'

export const engine_notice_kind = (status: EngineStatus, minimum_graphics = false) => {
  if (status.issue?.code === 'world_unavailable') return 'world'
  if (status.state === 'failed') return 'failed'
  if (minimum_graphics && status.backend !== 'grid') return 'minimum'
  return status.state === 'degraded' ? 'fallback' : null
}

export const EngineNotice = ({
  copy,
  status,
  dismiss,
  reload,
  minimum_graphics = false,
}: Readonly<{
  copy: AppCopy
  status: EngineStatus
  dismiss: () => void
  reload: () => void
  minimum_graphics?: boolean
}>) => {
  const kind = engine_notice_kind(status, minimum_graphics)
  if (!kind) return null
  const continue_action = { label: copy.continue, run: dismiss }
  const view = {
    minimum: {
      title: copy.engine_minimum_title,
      body: copy.engine_minimum,
      hint: null,
      action: { label: copy.engine_continue, run: dismiss },
    },
    world: { title: copy.world_unavailable_title, body: copy.world_unavailable, hint: null, action: continue_action },
    failed: {
      title: copy.world_unavailable_title,
      body: copy.engine_recovery,
      hint: null,
      action: { label: copy.engine_reload, run: reload },
    },
    fallback: {
      title: copy.title,
      body: copy.body,
      hint: /Chrome|Chromium|Edg/.test(navigator.userAgent) ? copy.chrome : copy.other,
      action: continue_action,
    },
  }[kind]
  return (
    <section className="fixed inset-0 z-[200] grid place-items-center bg-bg/88 p-5 backdrop-blur-lg">
      <div className="w-full max-w-lg border border-[#ff5a8b]/35 bg-bg p-7 shadow-[0_0_80px_rgba(255,27,141,0.12)]">
        <h2 className="mb-4 text-base font-semibold text-[#e8e4dc]">{view.title}</h2>
        <p className="mb-5 text-xs leading-6 text-[#a3a5ad]">{view.body}</p>
        {view.hint && <p className="mb-2 text-[11px] leading-5 text-[#d0ccd0]">{view.hint}</p>}
        <button
          className="mt-5 h-10 w-full cursor-pointer border border-[#4a9eff]/40 bg-[#4a9eff]/8 text-[10px] tracking-[0.18em] text-[#67adff] uppercase"
          onClick={view.action.run}
          type="button"
        >
          {view.action.label}
        </button>
      </div>
    </section>
  )
}
