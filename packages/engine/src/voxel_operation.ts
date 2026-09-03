// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

/** A city voxel operation replaces terrain when present. Zero is explicit air. */
export const apply_voxel_operation = (operation: number | undefined, terrain: number): number => operation ?? terrain
