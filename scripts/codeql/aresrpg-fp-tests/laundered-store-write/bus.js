// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Fixture event bus — gives the listener source (`.on`) something to hang off.
export const emitter = { on: (name, cb) => cb }
