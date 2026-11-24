// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { Engine, FightBlobRender } from './types.ts'

// The renderer facade owns lifecycle, frame cadence and fight-blob identity; the backend draws.
export type EngineBackend = Readonly<
  Omit<
    Engine,
    | 'start'
    | 'stop'
    | 'frame_count'
    | 'quality'
    | 'backend'
    | 'fail'
    | 'status'
    | 'subscribe_status'
    | 'create_fight_blob'
    | 'update_fight_blob'
  > & {
    /** Advance CPU animation and cue completion, including while the canvas is hidden. */
    tick: (now: number) => void
    render: (now: number) => void
    upsert_fight_blob: (blob: FightBlobRender) => void
  }
>
