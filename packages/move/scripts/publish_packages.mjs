// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The publish ceremony and release-pin gate must agree on this exact package graph.

const PUBLISH_PACKAGES = [
  { name: 'foundation', dependencies: [] },
  { name: 'spells', dependencies: ['foundation'] },
  { name: 'social', dependencies: [] },
  { name: 'engine', dependencies: ['foundation', 'spells'] },
  {
    name: 'aresrpg',
    dependencies: ['foundation', 'spells', 'engine'],
  },
  { name: 'kolizeum', dependencies: ['aresrpg', 'engine', 'social'] },
  { name: 'forgemagie', dependencies: ['aresrpg', 'foundation'] },
  { name: 'gifting', dependencies: ['aresrpg'] },
  { name: 'dungeon', dependencies: ['aresrpg', 'engine'] },
]

export const TICKET_ORDER = Object.freeze(
  PUBLISH_PACKAGES.map(({ name }) => name)
)

export const PKG_DEPS = Object.freeze(
  Object.fromEntries(
    PUBLISH_PACKAGES.map(({ name, dependencies }) => [
      name,
      Object.freeze(dependencies),
    ])
  )
)

export const RELEASE_PACKAGE_SET = TICKET_ORDER
