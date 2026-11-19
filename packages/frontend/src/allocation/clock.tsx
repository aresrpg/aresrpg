// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { useEffect, useState } from 'react'

/** Minute-resolution clock for sale countdowns; chain lifecycle remains the phase authority. */
export const useMinuteClock = (): number => {
  const [now, set_now] = useState(Date.now)
  useEffect(() => {
    const timer = setInterval(() => set_now(Date.now()), 30_000)
    return () => clearInterval(timer)
  }, [])
  return now
}
