// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Lightweight reducer-input edge. Kept separate from game.js's module graph so async boundaries (auth/tx) can
// enqueue an INPUT without importing the engine, its observers, or any store. game.js is the sole consumer.

import { PassThrough } from 'stream'

export const actions = new PassThrough({ objectMode: true })

/** @param {string} type @param {any} [payload] */
export function dispatch_action(type, payload) {
  actions.write({ type, payload })
}
