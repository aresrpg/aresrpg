// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

/** Layout twin of world.move. Chain coordinates are unsigned; client origin is the center. */
export const world_size = 100_000
export const world_center = world_size / 2

/** Chain positions are unsigned. Rendering stays close to zero so GPU transforms retain precision. */
export const chain_to_client_coordinate = (coordinate: number): number => coordinate - world_center

/** Inverse of chain_to_client_coordinate for live presence and on-chain movement inputs. */
export const client_to_chain_coordinate = (coordinate: number): number => coordinate + world_center
