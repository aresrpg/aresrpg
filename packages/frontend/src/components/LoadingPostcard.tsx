// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { AppCopy } from '../i18n/copy.ts'
import type { LoadingProgress } from '../game/core/loading_progress.ts'

import { engine_failure_message } from './EngineNotice.tsx'
import type { LoadingContext } from './loading_art.ts'

export type LoadingCopy = Pick<
  AppCopy,
  | 'world_loading_assets'
  | 'world_loading_graphics'
  | 'world_loading_terrain'
  | 'world_loading_sky'
  | 'world_loading_finishing'
  | 'body'
  | 'engine_graphics_failure'
  | 'engine_recovery'
  | 'engine_reload'
  | 'loading_screen'
>

const LoadingRecovery = ({
  slow,
  browser_reload,
  label,
  reload,
}: Readonly<{ slow: string; browser_reload: string; label: string; reload?: () => void }>) => (
  <div className="loading-recovery" data-recovery-ready={reload ? '' : undefined}>
    <p className="loading-slow" role="status">
      {slow}
    </p>
    <p className="loading-browser-reload">{browser_reload}</p>
    <button className="loading-reload" data-loading-reload="" type="button" disabled={!reload} onClick={reload}>
      {label}
    </button>
  </div>
)

/** Shared markup for the document's first paint and every mounted world. */
export const LoadingPostcard = ({
  copy,
  context,
  image,
  previous_image,
  wordmark,
  progress,
  phase,
  fraction,
  tip = 0,
  boot = false,
  previous_tip,
  next_tip,
  reload,
}: Readonly<{
  copy: LoadingCopy
  context: LoadingContext
  image: string
  previous_image?: string
  wordmark: string
  progress: LoadingProgress
  phase: number
  fraction: number | null
  tip?: number
  boot?: boolean
  previous_tip?: () => void
  next_tip?: () => void
  reload?: () => void
}>) => {
  const text = copy.loading_screen
  const statuses = {
    assets: copy.world_loading_assets,
    graphics: copy.world_loading_graphics,
    terrain: copy.world_loading_terrain,
    sky: copy.world_loading_sky,
    finishing: copy.world_loading_finishing,
    failed: engine_failure_message(progress.issue, copy),
    ready: text.ready,
  }
  const steps = [text.resources, text.graphics, text.world, text.final_checks]
  const tips = [text.tip_tools, text.tip_combat, text.tip_party, text.tip_map]
  const step = text.step.replace('{step}', String(Math.min(4, phase + 1))).replace('{total}', '4')
  const failed = progress.stage === 'failed'
  return (
    <div
      className="world-loading"
      data-world-loading={progress.stage}
      data-loading-context={context}
      {...(boot && {
        'data-loading-demo-title': text.demo_title,
        'data-loading-demo-description': text.demo_description,
        'data-loading-demo-eyebrow': text.demo_eyebrow,
      })}
      data-boot-loading={boot ? '' : undefined}
      data-loading-error={boot ? copy.engine_recovery : undefined}
    >
      {previous_image && <img className="loading-art" src={previous_image} alt="" decoding="async" />}
      <img
        key={image}
        className="loading-art loading-art-current"
        data-loading-art=""
        src={image}
        alt=""
        decoding="async"
        fetchPriority="high"
      />
      <div className="loading-shade" />
      <header className="loading-header">
        <img src={wordmark} alt="AresRPG" className="loading-wordmark" width="192" height="65" />
        <span className="loading-tagline">{text.eyebrow}</span>
      </header>
      <section className="loading-story">
        <div className="loading-destination">
          <span className="loading-kicker" data-loading-kicker="">
            {text[`${context}_eyebrow`]}
          </span>
          <h1 data-loading-title="">{text[`${context}_title`]}</h1>
          <p data-loading-description="">{text[`${context}_description`]}</p>
        </div>
        <aside className="loading-tip" aria-label={text.tip}>
          <div className="loading-tip-heading">
            <span>{text.tip}</span>
            <div className="loading-tip-controls">
              <small>{String(tip + 1).padStart(2, '0')} / 04</small>
              <button type="button" disabled={boot} onClick={previous_tip} aria-label={text.previous_tip}>
                ←
              </button>
              <button type="button" disabled={boot} onClick={next_tip} aria-label={text.next_tip}>
                →
              </button>
            </div>
          </div>
          <p>{tips[tip]}</p>
          <div className="loading-tip-dots" aria-hidden="true">
            {tips.map((_, index) => (
              <i key={index} data-active={index === tip} />
            ))}
          </div>
        </aside>
      </section>
      <section className="loading-progress">
        <div className="loading-status-row">
          <div className="loading-status" role={failed ? 'alert' : 'status'} aria-live="polite">
            <i className="loading-orbit" aria-hidden="true" />
            <span data-loading-status="">{statuses[progress.stage]}</span>
          </div>
          <span className="loading-step" data-loading-step="">
            {failed ? '' : step}
          </span>
        </div>
        <div
          className="world-loading-track"
          role="progressbar"
          aria-label={statuses[progress.stage]}
          aria-valuemin={0}
          aria-valuemax={4}
          aria-valuenow={phase === 4 ? 4 : fraction === null ? undefined : phase + fraction}
          aria-valuetext={step}
          hidden={failed}
        >
          {steps.map((_, index) => (
            <span key={index} className="loading-segment">
              <i
                data-indeterminate={index === phase && fraction === null}
                style={{ transform: `scaleX(${index < phase ? 1 : index === phase ? (fraction ?? 0.28) : 0})` }}
              />
            </span>
          ))}
        </div>
        <div className="loading-steps" aria-hidden="true">
          {steps.map((label, index) => (
            <span key={label} data-complete={index < phase} data-active={index === phase}>
              <i />
              {label}
            </span>
          ))}
        </div>
        <LoadingRecovery
          slow={text.slow}
          browser_reload={text.browser_reload}
          label={copy.engine_reload}
          reload={reload}
        />
      </section>
    </div>
  )
}
