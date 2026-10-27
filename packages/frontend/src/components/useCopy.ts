// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { useEffect, useState } from 'react'

/** Clipboard copy with a two-second confirmation the caller renders. */
export const useCopy = (): readonly [boolean, (value: string) => void] => {
  const [copied, set_copied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => set_copied(false), 2_000)
    return () => clearTimeout(timer)
  }, [copied])
  const copy = (value: string): void => {
    void navigator.clipboard.writeText(value).then(() => set_copied(true))
  }
  return [copied, copy]
}
