// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { SpellSynthesis } from './generated/claude_spell_synth.js'

export { create_audio_source } from './generated/claude_spell_audio.js'

/** The authored DSP is CPU work; only its transferred PCM reaches the main-thread audio graph. */
export const load_spell_synthesis = (signal: AbortSignal): Promise<SpellSynthesis> => {
  signal.throwIfAborted()
  const worker = new Worker(new URL('./spell_audio_worker.ts', import.meta.url), { type: 'module' })
  return new Promise((resolve, reject) => {
    const release = (): void => {
      worker.terminate()
      signal.removeEventListener('abort', abort)
    }
    const abort = (): void => {
      release()
      reject(signal.reason)
    }
    worker.onmessage = ({ data }: MessageEvent<SpellSynthesis>) => {
      release()
      resolve(data)
    }
    worker.onerror = (event) => {
      release()
      reject(new Error(event.message))
    }
    signal.addEventListener('abort', abort, { once: true })
    worker.postMessage(null)
  })
}
