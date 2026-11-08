// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { useId, useReducer } from 'react'
import { portrait_url, type PortraitAppearance } from '@aresrpg/immutable/portrait'

import type { AppCopy } from '../i18n/copy.ts'

import { ModalFrame } from './ModalFrame.tsx'
import {
  PORTRAIT_BACKGROUNDS,
  PORTRAIT_EXPORT_REVISION,
  initial_portrait_share,
  portrait_export_filename,
  portrait_export_url,
  reduce_portrait_share,
  type PortraitStyle,
} from './portrait_share.ts'
import './portrait_share.css'

export const PortraitStyleControls = ({
  style,
  copy,
  choose,
}: Readonly<{ style: PortraitStyle; copy: AppCopy; choose: (style: PortraitStyle) => void }>) => {
  const group = useId()
  const label = (background: PortraitStyle['background']) =>
    copy.ui[background ? `portrait_background_${background}` : 'portrait_transparent']!
  return (
    <div className="grid gap-4">
      <fieldset className="min-w-0">
        <legend className="mb-2 text-xs text-muted">
          <span className="uppercase tracking-widest">{copy.ui.portrait_backdrop}</span>
          <span className="ml-2 text-text">{label(style.background)}</span>
        </legend>
        <div className="flex flex-wrap gap-2">
          {[null, ...PORTRAIT_BACKGROUNDS].map((background) => (
            <label
              key={background ?? 'transparent'}
              className="relative h-12 w-12 cursor-pointer"
              title={label(background)}
            >
              <input
                className="peer sr-only"
                type="radio"
                name={group}
                value={background ?? 'transparent'}
                aria-label={label(background)}
                checked={style.background === background}
                onChange={() => choose({ ...style, background })}
              />
              <span className="portrait-share-checkerboard block h-full w-full overflow-hidden rounded border border-white/15 peer-checked:border-2 peer-checked:border-[#c8963c] peer-checked:shadow-[inset_0_0_0_1px_#e8c07a] peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[#e8c07a]">
                {background && (
                  <img
                    className="h-full w-full"
                    src={`/portrait-share/thumbs/${background}.png?revision=${PORTRAIT_EXPORT_REVISION}`}
                    alt=""
                  />
                )}
              </span>
            </label>
          ))}
        </div>
      </fieldset>
    </div>
  )
}

const PortraitShareContent = ({
  appearance,
  copy,
  close,
}: Readonly<{
  appearance: PortraitAppearance
  copy: AppCopy
  close: () => void
}>) => {
  const [state, dispatch] = useReducer(reduce_portrait_share, initial_portrait_share)
  const source = portrait_export_url(appearance, state)
  if (!source) return null
  const { generation, loaded, status } = state
  const copy_link = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(new URL(source, window.location.origin).href)
      dispatch({ type: 'copied', generation })
    } catch (error) {
      console.error('Portrait link copy failed', error)
      dispatch({ type: 'copy_failed', generation })
    }
  }
  return (
    <ModalFrame close={close} close_label={copy.ui.portrait_close} label={copy.ui.portrait_share} max_width="max-w-lg">
      <div className="grid gap-4 p-5">
        <div className="portrait-share-checkerboard relative aspect-square w-full">
          <img
            key={generation}
            className="aspect-square w-full"
            src={source}
            alt={copy.ui.portrait_preview}
            onLoad={() => dispatch({ type: 'loaded', generation })}
            onError={() => dispatch({ type: 'image_failed', generation })}
          />
        </div>
        <PortraitStyleControls style={state} copy={copy} choose={(style) => dispatch({ type: 'style', style })} />
        <div className="flex flex-wrap justify-center gap-3">
          {loaded && (
            <a className="btn-gold px-4 py-3" href={source} download={portrait_export_filename(appearance, state)}>
              {copy.ui.portrait_download}
            </a>
          )}
          <button type="button" className="btn-outline px-4 py-3" disabled={!loaded} onClick={() => void copy_link()}>
            {copy.ui.portrait_copy}
          </button>
        </div>
        <p role="status" className="text-center text-xs">
          {{ ready: '', copied: copy.ui.portrait_copied, failed: copy.ui.portrait_failed }[status]}
        </p>
        <input
          aria-label={copy.ui.portrait_copy}
          className="w-full border border-white/15 bg-surface-low p-2 text-xs"
          readOnly
          value={new URL(source, window.location.origin).href}
          onFocus={(event) => event.currentTarget.select()}
        />
      </div>
    </ModalFrame>
  )
}

export const PortraitShareModal = ({
  appearance,
  ...props
}: Readonly<{ appearance: PortraitAppearance | null; copy: AppCopy; close: () => void }>) =>
  appearance ? <PortraitShareContent key={portrait_url(appearance)} appearance={appearance} {...props} /> : null
