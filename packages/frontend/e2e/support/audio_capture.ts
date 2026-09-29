// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
export type AudioPlayback = Readonly<{ source: string; volume: number }>

/** Observe successful native playback; decoding, requests and autoplay policy remain real. */
export const capture_audio = (played: (record: AudioPlayback) => void): void => {
  const native_play = HTMLMediaElement.prototype.play
  Object.defineProperty(HTMLMediaElement.prototype, 'play', {
    configurable: true,
    value: new Proxy(native_play, {
      apply: (target, receiver, args) => {
        const player = receiver as HTMLMediaElement
        const record = { source: new URL(player.src).pathname, volume: player.volume }
        const playing = Reflect.apply(target, player, args) as Promise<void>
        return playing.then(() => played(record))
      },
    }),
  })
}
