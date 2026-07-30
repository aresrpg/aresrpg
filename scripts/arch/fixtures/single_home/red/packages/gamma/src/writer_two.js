// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// RED fixture — writer two of two for use_thing.phase and use_thing.dungeon.status, using Zustand's
// functional setState form. A scanner that only matches `setState({ ... })` loses this door; one that
// only keys the top-level object can never isolate the nested lifecycle fact.
import { use_thing } from './store.js'

export const close_phase = () => use_thing.setState(() => ({ phase: 'closed', dungeon: { status: 'closed' } }))
