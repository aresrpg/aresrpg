// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { useState } from 'react'

/** Selection is presentation-only and clamps when a certified refresh removes positions. */
export const useFinanceBatch = <T>(batches: readonly (readonly T[])[]) => {
  const [selection, select] = useState(0)
  const index = Math.min(selection, Math.max(0, batches.length - 1))
  return { index, select, batch: batches[index] ?? [] }
}
