// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import posthog, { type PostHogConfig } from 'posthog-js'

import type { AppState } from '../store.ts'

/** This pilot records anonymous tutorial DOM only. The WebGPU canvas is deliberately excluded. */
export const REPLAY_CONFIG = {
  // The session sampler below runs before downloading the recorder. Do not sample twice.
  sampleRate: 1,
  maskAllInputs: true,
  maskTextSelector: '*',
  blockSelector: 'canvas, iframe, input, textarea, [contenteditable], .ph-no-capture',
  maskAttributeFn: (name: string, value: string): string =>
    ['class', 'style', 'width', 'height', 'type', 'role'].includes(name) && !/url\(|[?#]|https?:/i.test(value)
      ? value
      : '',
  recordCrossOriginIframes: false,
  recordHeaders: false,
  recordBody: false,
  captureJsonLd: false,
  captureCanvas: { recordCanvas: false },
  maskCapturedNetworkRequestFn: () => null,
} satisfies NonNullable<PostHogConfig['session_recording']>

export const replay_sampled = (session_id: string): boolean =>
  Number.parseInt(session_id.replaceAll('-', '').slice(-8), 16) < 0x1_0000_0000 * 0.1

export const replay_eligible = (state: AppState, pathname: string): boolean =>
  pathname.replace(/\/+$/, '') === '/play-demo' &&
  state.session.wallet === null &&
  state.session.auth_status !== 'connecting' &&
  state.adventure.character !== null &&
  !['ending', 'complete', 'entered'].includes(state.adventure.phase)

export const replay_properties = (properties: Readonly<Record<string, unknown>>): Record<string, unknown> =>
  Object.fromEntries(
    Object.entries(properties).filter(([key]) =>
      [
        '$snapshot_data',
        '$snapshot_bytes',
        '$session_id',
        '$window_id',
        '$lib',
        '$lib_version',
        'distinct_id',
        'token',
      ].includes(key)
    )
  )

export const create_replay_observer = (
  load: () => Promise<unknown> = () => import('posthog-js/dist/posthog-recorder'),
  start: () => void = () => posthog.startSessionRecording(),
  stop: () => void = () => posthog.stopSessionRecording(),
  sampled: () => boolean = () => replay_sampled(posthog.get_session_id())
) => {
  let active = false
  let generation = 0
  return (eligible: boolean): void => {
    const selected = eligible && sampled()
    if (selected === active) return
    active = selected
    const own_generation = ++generation
    if (!selected) {
      try {
        stop()
      } catch (error) {
        console.error('Onboarding replay could not stop.', error)
      }
      return
    }
    void load()
      .then(() => {
        if (active && own_generation === generation) start()
      })
      .catch((error: unknown) => console.error('Onboarding replay could not start.', error))
  }
}
