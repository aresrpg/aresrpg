// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

const revisions = {
  decision_revision: { type: 'integer', minimum: 0 },
  observation_revision: { type: 'integer', minimum: 0 },
}
export const PROFESSION_TOOLS = [
  {
    name: 'bot_profession_status',
    description:
      'Read an existing legacy profession run’s progress, next blocker and exact last command. Completion means an observed job level reached the target, never estimated XP.',
    properties: { run_id: { type: 'string' } },
    required: ['run_id'],
    scope: 'bot:observe',
    read_only: true,
  },

  {
    name: 'bot_resume_profession',
    description:
      'Explicitly resume an existing legacy awaiting-AI or paused profession plan after fresh observation. Preserves its action count and any caller-supplied limits; does not replay a failed or uncertain action.',
    properties: { run_id: { type: 'string' }, ...revisions },
    required: ['run_id', 'decision_revision', 'observation_revision'],
    scope: 'bot:play',
    read_only: false,
  },
] as const
