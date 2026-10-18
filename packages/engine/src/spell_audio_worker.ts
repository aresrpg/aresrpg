// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { synthesize_spell_audio } from './generated/claude_spell_synth.js'

self.onmessage = () => {
  const synthesis = synthesize_spell_audio()
  self.postMessage(
    synthesis,
    Object.values(synthesis.samples).map((sample) => sample.buffer)
  )
}
