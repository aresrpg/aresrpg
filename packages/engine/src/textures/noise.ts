// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

const FNV_OFFSET = 0x811c9dc5
const FNV_PRIME = 0x01000193
const U32 = 4294967296

export const hash32 = (...values: readonly number[]): number => {
  let hash = FNV_OFFSET
  for (const value of values) {
    hash = (hash ^ (value | 0)) >>> 0
    hash = Math.imul(hash, FNV_PRIME) >>> 0
    hash = (hash ^ (hash >>> 15)) >>> 0
    hash = Math.imul(hash, 0x2c1b3c6d) >>> 0
    hash = (hash ^ (hash >>> 12)) >>> 0
    hash = Math.imul(hash, 0x297a2d39) >>> 0
    hash = (hash ^ (hash >>> 15)) >>> 0
  }
  return hash >>> 0
}

export const hash01 = (...values: readonly number[]): number => hash32(...values) / U32
