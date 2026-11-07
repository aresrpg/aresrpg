// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { useState } from 'react'
import { portrait_url, type PortraitAppearance } from '@aresrpg/immutable/portrait'

import type { AppCopy } from '../i18n/copy.ts'

import { ModalFrame } from './ModalFrame.tsx'

const PortraitShareContent = ({
  appearance,
  copy,
  close,
}: Readonly<{
  appearance: PortraitAppearance
  copy: AppCopy
  close: () => void
}>) => {
  const [loaded, set_loaded] = useState(false)
  const [status, set_status] = useState<'ready' | 'copied' | 'failed'>('ready')
  const source = portrait_url(appearance)
  if (!source) return null
  const copy_link = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(new URL(source, window.location.origin).href)
      set_status('copied')
    } catch (error) {
      console.error('Portrait link copy failed', error)
      set_status('failed')
    }
  }
  return (
    <ModalFrame close={close} close_label={copy.ui.portrait_close} label={copy.ui.portrait_share}>
      <div className="grid gap-4 p-5">
        {
          <img
            className="aspect-square w-full bg-surface-low"
            src={source}
            alt={copy.ui.portrait_preview}
            onLoad={() => set_loaded(true)}
            onError={() => set_status('failed')}
          />
        }
        <div className="flex flex-wrap justify-center gap-3">
          {loaded && (
            <a className="btn-gold px-4 py-3" href={source} download={`${appearance.classe}_${appearance.sex}.png`}>
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
        {source && (
          <input
            aria-label={copy.ui.portrait_copy}
            className="w-full border border-white/15 bg-surface-low p-2 text-xs"
            readOnly
            value={new URL(source, window.location.origin).href}
            onFocus={(event) => event.currentTarget.select()}
          />
        )}
      </div>
    </ModalFrame>
  )
}

export const PortraitShareModal = ({
  appearance,
  ...props
}: Readonly<{ appearance: PortraitAppearance | null; copy: AppCopy; close: () => void }>) =>
  appearance ? <PortraitShareContent key={portrait_url(appearance)} appearance={appearance} {...props} /> : null
