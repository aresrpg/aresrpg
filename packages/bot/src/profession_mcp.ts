// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { PROFESSION_PLAN_SCHEMA } from './profession_plan.ts'

const revisions = {
  decision_revision: { type: 'integer', minimum: 0 },
  observation_revision: { type: 'integer', minimum: 0 },
}
export const PROFESSION_TOOLS = [
  {
    name: 'bot_validate_plan',
    description:
      'Validate an AI-authored profession plan without execution. Returns typed static errors, requirements, caller limits and current live checks when the actor is ready. Never signs, simulates or submits. Static validity is not a promise of runtime success.',
    properties: { plan: PROFESSION_PLAN_SCHEMA },
    required: ['plan'],
    scope: 'bot:observe',
    read_only: true,
  },
  {
    name: 'bot_profession_status',
    description:
      'Read durable profession progress, next blocker and exact last command. Completion means an observed job level reached the target, never estimated XP.',
    properties: { run_id: { type: 'string' } },
    required: ['run_id'],
    scope: 'bot:observe',
    read_only: true,
  },
  {
    name: 'bot_start_profession',
    description:
      'Start one durable finite profession plan. Gathers approved direct ingredients and attempts the selected recipe, one SDK action at a time. Stops for combat, missing routes, failures, pause, revocation, max_actions or deadline. Crafting attempts consume ingredients even on failed craft rolls. No purchases, arbitrary code or automatic combat.',
    properties: { idempotency_key: { type: 'string' }, plan: PROFESSION_PLAN_SCHEMA, ...revisions },
    required: ['idempotency_key', 'plan', 'decision_revision', 'observation_revision'],
    scope: 'bot:play',
    read_only: false,
  },
  {
    name: 'bot_resume_profession',
    description:
      'Explicitly resume an awaiting-AI or paused profession plan after fresh observation. Preserves its original action count and deadline; does not replay a failed or uncertain action.',
    properties: { run_id: { type: 'string' }, ...revisions },
    required: ['run_id', 'decision_revision', 'observation_revision'],
    scope: 'bot:play',
    read_only: false,
  },
] as const
