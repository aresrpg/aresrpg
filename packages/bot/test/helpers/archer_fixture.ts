// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

/** An archer (class `yogan`) build as an AI client may author one: stat and spell priorities for the
 * `spend_points` leaf, item stats for `equip_owned best_stats`, and a combat profile. Test data only:
 * the shared catalogue binds no build. */
export const archer_build = {
  stats: ['intelligence'],
  spells: ['Magic Arrow', 'Distant Shooting', 'Critical Shooting', 'Powerful Shooting'],
  equipment: ['intelligence', 'vitality', 'wisdom'],
  profile: {
    version: '1',
    intent:
      'Shoot Magic Arrow at the enemy it hurts most, moving for damage when possible. Spend what is left on the learned shooting buffs, then approach. End the turn when no action is legal.',
    combos: [
      {
        name: 'attack',
        steps: [
          {
            type: 'cast',
            spell: 'Magic Arrow',
            target: 'highest_damage_enemy',
            position: 'best_damage',
          },
        ],
      },
      {
        name: 'range',
        steps: [
          {
            type: 'cast',
            spell: 'Distant Shooting',
            target: 'self',
            if_learned: true,
          },
        ],
      },
      {
        name: 'critical',
        steps: [
          {
            type: 'cast',
            spell: 'Critical Shooting',
            target: 'self',
            if_learned: true,
          },
        ],
      },
      {
        name: 'power',
        steps: [
          {
            type: 'cast',
            spell: 'Powerful Shooting',
            target: 'self',
            if_learned: true,
          },
        ],
      },
      {
        name: 'approach',
        steps: [
          {
            type: 'move',
            direction: 'approach',
          },
        ],
      },
    ],
    rules: [
      {
        when: {
          type: 'always',
        },
        combo: 'attack',
      },
      {
        when: {
          type: 'always',
        },
        combo: 'range',
      },
      {
        when: {
          type: 'always',
        },
        combo: 'critical',
      },
      {
        when: {
          type: 'always',
        },
        combo: 'power',
      },
      {
        when: {
          type: 'always',
        },
        combo: 'approach',
      },
    ],
    fallback: 'end_turn',
  },
} as const
