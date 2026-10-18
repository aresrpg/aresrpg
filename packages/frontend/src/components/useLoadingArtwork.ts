// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { useEffect, useState } from 'react'

import { loading_images, select_loading_image, boot_loading_image, type LoadingContext } from './loading_art.ts'

export const useLoadingArtwork = (context: LoadingContext, active: boolean) => {
  const [art, set_art] = useState<{ image: string; previous_image?: string }>(() => ({
    image: boot_loading_image(context) ?? loading_images(context)[0]!,
  }))
  useEffect(() => {
    if (!active) return
    let live = true
    const images = loading_images(context)
    let current = boot_loading_image(context) ?? select_loading_image(context)
    const show = async (image: string): Promise<void> => {
      const picture = new Image()
      // eslint-disable-next-line functional/immutable-data -- this effect owns the detached image used for decoding.
      picture.src = image
      try {
        await picture.decode()
        if (live) {
          document.documentElement.removeAttribute('data-loading-art-context')
          document.documentElement.removeAttribute('data-loading-art')
          set_art((previous) => ({ image, previous_image: previous.image === image ? undefined : previous.image }))
        }
      } catch (error) {
        console.warn('Loading postcard could not be decoded.', error)
      }
    }
    void show(current)
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
    const timer = reduced
      ? null
      : setInterval(() => {
          current = images[(images.indexOf(current) + 1) % images.length]!
          void show(current)
        }, 12000)
    return () => {
      live = false
      if (timer !== null) clearInterval(timer)
    }
  }, [context, active])
  return art
}
