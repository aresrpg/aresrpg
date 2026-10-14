// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Real entity motion with model loading isolated at the engine's hardware boundary.
import { Group, Scene } from 'three'

import { create_entity_layer } from '../src/entities.ts'

export const create_sequence_entities = () =>
  create_entity_layer({
    scene: new Scene(),
    load_model: async () => ({ root: new Group(), clips: [], min_y: 0, dispose: () => {} }),
  })
