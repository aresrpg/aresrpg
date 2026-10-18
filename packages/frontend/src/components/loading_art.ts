// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import catalogue from '../../../../seed/content/loading_screens.json'

export type LoadingContext = 'home' | 'demo' | 'world'
export const loading_wordmark = new URL('../../../../seed/icons/loading/wordmark.webp', import.meta.url).href
export const loading_images = (context: LoadingContext): readonly string[] =>
  catalogue
    .filter((row) => row.context === context)
    .map(({ id }) => new URL(`../../../../seed/icons/loading/${id}.webp`, import.meta.url).href)

/** Rotation belongs to the loading-screen lifetime; no asset request runs at module import. */
export const select_loading_image = (context: LoadingContext): string => {
  const images = loading_images(context)
  try {
    const key = `ares_loading_${context}`
    const previous = Number(sessionStorage.getItem(key) ?? -1)
    const next = Number.isSafeInteger(previous) ? (previous + 1) % images.length : 0
    sessionStorage.setItem(key, String(next))
    return images[Math.max(0, next)]!
  } catch (error) {
    console.warn('Loading artwork rotation could not be saved.', error)
    return images[0]!
  }
}

export const boot_loading_image = (context: LoadingContext): string | undefined => {
  const root = globalThis.document?.documentElement
  if (root?.getAttribute('data-loading-art-context') !== context) return undefined
  const image = root.getAttribute('data-loading-art')
  return image && loading_images(context).includes(image) ? image : undefined
}
