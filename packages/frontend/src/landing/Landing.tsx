// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Draft authored by Claude Opus 5.5 (claude-opus-5-5): accepted V19 landing as a pure React surface.
//
// Target: packages/frontend/src/landing/. Presentation only. It owns no route, store, reader or economics:
// the entry supplies copy, art, public links, on_play, agent_connect_url and the shared TokenomicsPanel node.
import { NativeModal } from '@aresrpg/ui'
import { useEffect, useRef, useState, type MouseEvent, type PointerEvent } from 'react'

import { KaresLogo } from '../components/KaresLogo.tsx'

import { start_landing_motion } from './landing_motion.ts'
import { LandingAgent, LandingEarn, LandingEnd, LandingHero, LandingWorld } from './LandingSections.tsx'
import { LandingSurface } from './LandingSurface.tsx'
import type { LandingProps } from './landing_types.ts'

import './landing.css'

type DialogEvent = MouseEvent<HTMLDialogElement> | PointerEvent<HTMLDialogElement>

/** True for a press on the native backdrop: the dialog itself is the target and the point lies outside its box. */
const on_backdrop = (event: Readonly<DialogEvent>): boolean => {
  if (event.target !== event.currentTarget) return false
  const box = event.currentTarget.getBoundingClientRect()
  return event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom
}

export const Landing = ({ copy, assets, links, on_play, agent_connect_url, tokenomics }: LandingProps) => {
  const root = useRef<HTMLDivElement>(null)
  const dock = useRef<HTMLButtonElement>(null)
  const [open, set_open] = useState(false)
  const modal_open = useRef(false)
  const was_open = useRef(false)
  const press_outside = useRef(false)

  useEffect(() => {
    // eslint-disable-next-line functional/immutable-data -- the motion lifecycle reads the latest modal visibility.
    modal_open.current = open
    if (was_open.current && !open) dock.current?.focus({ preventScroll: true })
    // eslint-disable-next-line functional/immutable-data -- remembers the previous render's visibility for focus return.
    was_open.current = open
  }, [open])

  useEffect(() => {
    const element = root.current
    if (!element) return
    return start_landing_motion(element, {
      status_connecting: copy.agent.status_connecting,
      status_watching: copy.agent.status_watching,
      is_modal_open: () => modal_open.current,
    })
  }, [copy.agent.status_connecting, copy.agent.status_watching])

  const close = (): void => set_open(false)
  const kares_trigger = (
    <button
      aria-controls="landing-kares-modal"
      aria-expanded={open}
      aria-haspopup="dialog"
      className="kares-dock"
      data-landing="dock"
      onClick={() => set_open(true)}
      ref={dock}
      type="button"
    >
      <KaresLogo size={24} />
      <span className="dock-name">{copy.kares.trigger}</span>
      <span className="dock-sub">{copy.kares.trigger_detail}</span>
    </button>
  )

  return (
    <div className="landing" ref={root}>
      <LandingSurface assets={assets} />
      <div className="landing-flow" data-landing="flow">
        <LandingHero
          agent_connect_url={agent_connect_url}
          assets={assets}
          copy={copy}
          kares_trigger={kares_trigger}
          links={links}
          on_play={on_play}
        />
        <main>
          <LandingEarn assets={assets} copy={copy} links={links} />
          <LandingWorld assets={assets} copy={copy} />
          <LandingAgent assets={assets} copy={copy} />
          <LandingEnd copy={copy} links={links} on_play={on_play} />
        </main>
      </div>
      {open && (
        <NativeModal
          className="landing-modal"
          close={close}
          id="landing-kares-modal"
          label={copy.kares.modal_label}
          onClick={(event) => {
            if (press_outside.current && on_backdrop(event)) close()
            // eslint-disable-next-line functional/immutable-data -- one press is consumed by its click.
            press_outside.current = false
          }}
          onPointerDown={(event) => {
            // eslint-disable-next-line functional/immutable-data -- a drag that starts inside never dismisses.
            press_outside.current = on_backdrop(event)
          }}
        >
          <div className="landing-modal-bar">
            <button className="landing-modal-close" onClick={close} type="button">
              <svg aria-hidden="true" height="12" viewBox="0 0 12 12" width="12">
                <path
                  d="M1 0h2v1h1v1h1v1h2V2h1V1h1V0h2v2h-1v1h-1v1H9v1H8v2h1v1h1v1h1v1h1v2h-2v-1H9v-1H8V9H7V8H5v1H4v1H3v1H2v1H0v-2h1V9h1V8h1V7h1V5H3V4H2V3H1V2H0V0z"
                  fill="currentColor"
                />
              </svg>
              {copy.kares.close}
            </button>
          </div>
          {tokenomics}
        </NativeModal>
      )}
    </div>
  )
}
