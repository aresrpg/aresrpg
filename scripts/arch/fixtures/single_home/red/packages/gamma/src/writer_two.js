// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// RED fixture — writer two of two for use_thing.phase, using Zustand's functional setState form:
// one store fact, two writing modules. A scanner that only matches `setState({ ... })` loses this door.
import { use_thing } from './store.js'

export const close_phase = () => use_thing.setState(() => ({ phase: 'closed' }))
