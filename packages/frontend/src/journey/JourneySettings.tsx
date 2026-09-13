// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { BookOpen } from 'lucide-react'

import { copy_text, type AppCopy } from '../i18n/copy.ts'
import { dispatch_app, useAppStore } from '../store.ts'

export const JourneySettings = ({ copy }: Readonly<{ copy: AppCopy }>) => {
  const ready = useAppStore((state) => state.journey.ready && state.journey.identity !== null)
  const saving = useAppStore((state) => state.journey.saving)
  const text = copy_text(copy.journey)
  return (
    <div className="flex min-w-0 flex-wrap items-center justify-between gap-4 border border-border bg-surface/80 p-4 lg:p-5">
      <div className="flex min-w-0 flex-1 basis-40 items-center gap-3">
        <BookOpen className="shrink-0 text-gold" size={15} />
        <div>
          <div className="text-[11px] text-text">{text('reset_title')}</div>
          <div className="mt-1 text-[9px] leading-5 text-muted">{text('reset_hint')}</div>
        </div>
      </div>
      <button
        className="btn-outline px-3 py-2 text-[9px] disabled:opacity-40"
        disabled={!ready}
        onClick={() => dispatch_app({ type: 'journey/journal', open: true })}
        type="button"
      >
        {text('journal')}
      </button>
      <button
        className="btn-outline px-3 py-2 text-[9px] disabled:opacity-40"
        disabled={!ready}
        onClick={() => dispatch_app({ type: 'journey/reset' })}
        type="button"
      >
        {text(saving ? 'saving' : 'reset_action')}
      </button>
    </div>
  )
}
