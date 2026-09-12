// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

export const KONAMI_CODE = [
  'ArrowUp',
  'ArrowUp',
  'ArrowDown',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'ArrowLeft',
  'ArrowRight',
  'KeyB',
  'KeyA',
] as const

/** Retain the longest matching prefix, including overlapping Up presses. */
export const advance_konami = (prefix: readonly string[], code: string): readonly string[] => {
  const keys = [...prefix, code].slice(-KONAMI_CODE.length)
  for (let length = keys.length; length > 0; length -= 1) {
    const suffix = keys.slice(-length)
    if (suffix.every((key, index) => key === KONAMI_CODE[index])) return suffix
  }
  return []
}
