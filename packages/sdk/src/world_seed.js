// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

/**
 * The deterministic seed stored on every authored World. This is the one home shared by the seed
 * ceremony and clients that join a republished World object back to its stable authored id.
 * @param {string} world_id
 * @returns {number}
 */
export const world_seed = (world_id) =>
  Array.from(String(world_id)).reduce(
    (seed, character) => ((seed * 33) ^ character.charCodeAt(0)) >>> 0,
    5381
  ) || 1
