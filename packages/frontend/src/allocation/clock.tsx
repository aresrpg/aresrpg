// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { Fragment, useEffect, useState } from 'react'
import { campaign } from '@aresrpg/immutable/allocation'

import type { CopyText } from '../i18n/copy.ts'

import { countdown } from './view.ts'

export const useCampaignClosed = (): boolean => {
  const elapsed = () => Date.now() >= Date.parse(campaign.submissions_close_at)
  const [closed, set_closed] = useState(elapsed)
  useEffect(() => {
    const timer = setInterval(() => set_closed(elapsed()), 1000)
    return () => clearInterval(timer)
  }, [])
  return closed
}
export const Timer = ({ text, closed }: Readonly<{ text: CopyText; closed: boolean }>) => {
  const [now, set_now] = useState(Date.now)
  useEffect(() => {
    if (closed) return
    const timer = setInterval(() => set_now(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [closed])
  const parts = closed ? [0, 0, 0, 0] : countdown(now)
  return (
    <div className={`t-clock${closed ? ' is-done' : ''}`} role="timer" aria-label={text('entries_close')}>
      {parts.map((value, index) => (
        <Fragment key={index}>
          {index > 0 && <i className="t-sep">:</i>}
          <span className="t-unit">
            <b>{String(value).padStart(2, '0')}</b>
            <small>{text(['days', 'hours', 'minutes', 'seconds'][index])}</small>
          </span>
        </Fragment>
      ))}
    </div>
  )
}

/** Refresh only the authenticated projection; never retry a submission or signature. */
export const useCampaignRefresh = (
  runtime: Readonly<import('./runtime.ts').AllocationRuntime>,
  enabled: boolean
): void => {
  useEffect(() => {
    if (!enabled) return
    const refresh = (): void => runtime.dispatch({ type: 'request', task: { kind: 'load' } })
    const timer = setInterval(refresh, 30000)
    globalThis.addEventListener('focus', refresh)
    return () => {
      clearInterval(timer)
      globalThis.removeEventListener('focus', refresh)
    }
  }, [runtime, enabled])
}

/** Minute-resolution clock for sale countdowns; chain lifecycle remains the phase authority. */
export const useMinuteClock = (): number => {
  const [now, set_now] = useState(Date.now)
  useEffect(() => {
    const timer = setInterval(() => set_now(Date.now()), 30_000)
    return () => clearInterval(timer)
  }, [])
  return now
}
