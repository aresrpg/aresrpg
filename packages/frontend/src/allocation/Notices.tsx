// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { useEffect, useId, useRef } from 'react'
import { AlertCircle, X } from 'lucide-react'

import type { AppCopy, CopyText } from '../i18n/copy.ts'
import { error_text } from '../i18n/error_text.ts'

import type { AllocationRuntime, AllocationState } from './runtime.ts'

export const Notices = ({
  state,
  runtime,
  copy,
  text,
}: Readonly<{ state: AllocationState; runtime: AllocationRuntime; copy: AppCopy; text: CopyText }>) => {
  const dialog = useRef<HTMLDialogElement>(null)
  const title = useId()
  useEffect(() => {
    if (state.error) dialog.current?.showModal()
    else dialog.current?.close()
  }, [state.error, state.sequence])
  const recovery: Readonly<Record<string, 'reconnect' | 'load'>> = {
    connection_failed: 'reconnect',
    connection_replaced: 'reconnect',
    connection_timeout: 'reconnect',
    x_changed: 'load',
  }
  const action = recovery[state.error ?? '']
  return (
    <dialog className="wallet-picker allocation-error-dialog" ref={dialog} role="alertdialog" aria-labelledby={title}>
      <header>
        <AlertCircle size={24} aria-hidden="true" />
        <h2 id={title}>{text('error_title')}</h2>
        <button type="button" className="btn-icon" aria-label={text('close')} onClick={() => dialog.current?.close()}>
          <X size={18} />
        </button>
      </header>
      <p>{state.error && (copy.allocation_page[`error_${state.error}`] ?? error_text(copy.kares_page, state.error))}</p>
      <footer>
        <button type="button" className="btn" onClick={() => dialog.current?.close()}>
          {text('close')}
        </button>
        {action && (
          <button
            type="button"
            className="btn btn-ink"
            disabled={!!state.task}
            onClick={() => runtime.dispatch({ type: 'request', task: { kind: action } })}
          >
            {text(action === 'reconnect' ? 'reconnect' : 'refresh')}
          </button>
        )}
      </footer>
    </dialog>
  )
}
