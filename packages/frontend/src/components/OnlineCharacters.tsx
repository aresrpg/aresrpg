// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { ContactRound } from 'lucide-react'
import { useId, useRef } from 'react'

import type { AppCopy } from '../i18n/copy.ts'

export const OnlineCharacters = ({
  copy,
  online,
  characters,
}: Readonly<{
  copy: AppCopy
  online: number | null
  characters: number | null
}>) => {
  const id = useId()
  const trigger = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const show = () => {
    const button = trigger.current
    const detail = panel.current
    if (!button || !detail) return
    const bounds = button.getBoundingClientRect()
    detail.style.setProperty('left', `${Math.max(8, Math.min(bounds.left, window.innerWidth - 268))}px`)
    detail.style.setProperty('top', `${bounds.bottom}px`)
    detail.showPopover()
  }
  return (
    <span
      className="world-online-characters"
      onPointerEnter={(event) => {
        if (event.pointerType === 'mouse') show()
      }}
      onPointerLeave={(event) => {
        if (event.pointerType === 'mouse' && document.activeElement !== trigger.current) panel.current?.hidePopover()
      }}
    >
      <button
        ref={trigger}
        type="button"
        title=""
        className="world-online-count"
        popoverTarget={id}
        popoverTargetAction="show"
        aria-label={`${copy.online_characters}: ${characters ?? '—'}`}
        aria-describedby={id}
        onFocus={show}
        onBlur={() => panel.current?.hidePopover()}
        onClick={show}
      >
        <span aria-hidden="true">(</span>
        <ContactRound size={13} aria-hidden="true" />
        <b>{characters ?? '—'}</b>
        <span aria-hidden="true">)</span>
      </button>
      <div ref={panel} id={id} popover="auto" className="world-online-details">
        <dl>
          <div>
            <dt>{copy.online_accounts}</dt>
            <dd>{online ?? '—'}</dd>
          </div>
          <div>
            <dt>{copy.online_characters}</dt>
            <dd>{characters ?? '—'}</dd>
          </div>
        </dl>
        <p>{copy.online_characters_body}</p>
      </div>
    </span>
  )
}
