// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/** One decoded recording, with independent short voices for every carousel crossing. */
export const create_carousel_audio = (source: string, volume: () => number) => {
  let context: AudioContext | null = null
  let master: GainNode | null = null
  let decoded: Promise<AudioBuffer> | null = null
  const voices = new Set<AudioBufferSourceNode>()

  const prime = (): void => {
    if (typeof AudioContext === 'undefined') return
    context ??= new AudioContext()
    if (!master) {
      master = context.createGain()
      master.connect(context.destination)
    }
    master.gain.value = volume()
    const active = context
    if (active.state === 'suspended')
      void active.resume().catch((error: unknown) => console.warn('Carousel audio could not resume.', error))
    decoded ??= fetch(source).then(async (response) => {
      if (!response.ok) throw new Error('Carousel audio is unavailable')
      return active.decodeAudioData(await response.arrayBuffer())
    })
    void decoded.catch((error: unknown) => console.warn('Carousel audio could not load.', error))
  }

  const schedule = (crossings: readonly number[]): (() => void) => {
    const active = context
    const gain = master
    const buffer = decoded
    if (!active || !gain || !buffer) return () => {}
    let cancelled = false
    const local = new Set<AudioBufferSourceNode>()
    const started = performance.now()
    void buffer
      .then((sample) => {
        if (cancelled || context !== active || active.state !== 'running') return
        const elapsed = performance.now() - started
        crossings.forEach((crossing, index) => {
          if (crossing < elapsed) return
          const player = active.createBufferSource()
          const envelope = active.createGain()
          const start = active.currentTime + (crossing - elapsed) / 1000
          const peak = 0.24 * Math.min(1, 40 / crossings.length)
          // eslint-disable-next-line functional/immutable-data -- Assign the decoded sample to this newly constructed browser voice.
          player.buffer = sample
          // eslint-disable-next-line functional/immutable-data -- Playback rate is an imperative Web Audio parameter on the new voice.
          player.playbackRate.value = 1.08 - (0.16 * (index + 1)) / crossings.length
          envelope.gain.setValueAtTime(0, start)
          envelope.gain.linearRampToValueAtTime(peak, start + 0.004)
          envelope.gain.exponentialRampToValueAtTime(peak / 10, start + 0.14)
          envelope.gain.linearRampToValueAtTime(0, start + 0.24)
          player.connect(envelope)
          envelope.connect(gain)
          local.add(player)
          voices.add(player)
          // eslint-disable-next-line functional/immutable-data -- Browser completion releases this voice and its private gain node.
          player.onended = () => {
            local.delete(player)
            voices.delete(player)
            player.disconnect()
            envelope.disconnect()
          }
          player.start(start, 0.043)
          player.stop(start + 0.24)
        })
      })
      .catch((error: unknown) => console.warn('Carousel audio could not play.', error))
    return () => {
      cancelled = true
      local.forEach((voice) => voice.stop())
      local.clear()
    }
  }

  return {
    prime,
    schedule,
    sync: () => {
      if (master) master.gain.value = volume()
    },
    dispose: (): void => {
      voices.forEach((voice) => voice.stop())
      voices.clear()
      const active = context
      context = null
      master = null
      decoded = null
      if (active) void active.close().catch((error: unknown) => console.warn('Carousel audio could not close.', error))
    },
  }
}
