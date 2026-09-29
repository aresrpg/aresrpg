// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { createRoot } from 'react-dom/client'

import { capture_audio, type AudioPlayback } from '../support/audio_capture.ts'
import { create_app } from '../../src/store.ts'

const app = create_app()
app.observe(['settings', 'audio', 'adventure', 'fight'])
const log: AudioPlayback[] = []
capture_audio((record) => {
  log.push(record)
  document.getElementById('audio-events')!.textContent = JSON.stringify(log)
})

const drain_presentations = (): void => {
  for (let count = 0; count < 20; count += 1) {
    const [presentation] = app.store.getState().fight.presentations
    if (!presentation) return
    app.dispatch({ type: 'fight/presented', presentation })
  }
  throw new Error('Fight presentations did not drain')
}

const finish = (): void => {
  app.dispatch({ type: 'adventure/entered' })
  app.dispatch({ type: 'adventure/challenge' })
  const fight = app.store.getState().fight.checkpoint!.contract.id
  app.dispatch({ type: 'fight/input', fight, origin: 'local', input: { type: 'ready', fighter: 0n } })
  drain_presentations()
  app.dispatch({ type: 'fight/input', fight, origin: 'local', input: { type: 'forfeit', fighter: 0n } })
  drain_presentations()
  const { result } = app.store.getState().adventure
  document.getElementById('result')!.textContent = result?.result_open ? 'fight over' : 'missing result'
}

createRoot(document.getElementById('root')!).render(
  <>
    <button onClick={finish}>Finish demo fight</button>
    <button onClick={() => app.dispatch({ type: 'adventure/result_acknowledged', screen: 'result' })}>
      Close result
    </button>
    <output id="result">idle</output>
    <output id="audio-events">[]</output>
  </>
)
