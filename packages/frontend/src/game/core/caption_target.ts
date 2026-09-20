// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { WorldCaption } from '@aresrpg/engine'

/** UI effects may outlive a range/scene change; a retired target can never attach a label again. */
export const create_caption_target = (write: (caption: WorldCaption | null) => void) => {
  let active = true
  return Object.freeze({
    set: (caption: WorldCaption | null): void => {
      if (active) write(caption)
    },
    dispose: (): void => {
      if (!active) return
      active = false
      write(null)
    },
  })
}
