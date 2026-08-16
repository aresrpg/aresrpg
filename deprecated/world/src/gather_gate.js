// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// GATHER GATE — the LOCAL [G] affordance pre-check: no need to fire a TX just to learn the tool
// isn't equipped, the app checks that itself first. Mirrors the on-chain refusals in
// `aresrpg::gathering::gather` (104/105 no/wrong tool · 106 tier-locked) off the SAME read-model the paperdoll
// / JobsDrawer render, so a doomed tx never fires from the prompt. The chain abort_copy net stays the last
// resort (a stale read, or a tool unequipped between the check and the press). PURE — returns a reason code,
// the caller (DiscoveryPrompts) owns the i18n copy.

import {
  JOBS,
  JOB_CATEGORY,
  equipped_gather_tool,
  job_from_tool,
  job_level_progress,
  tier_to_level,
} from '@aresrpg/sdk/jobs'

// The 3 GATHERING jobs in on-chain enum order — world.move: a resource node's `job` u8 is 0 FARMER /
// 1 HERBALIST / 2 MINER, which matches the SDK JOBS gather order (farmer, herbalist, miner).
const GATHER_JOBS = JOBS.filter((j) => j.category === JOB_CATEGORY.GATHERING)

/**
 * @typedef {{ ok: true } | { ok: false, reason: 'tool' | 'tier', tool: string, job: string, level: number }} GatherGate
 */

/**
 * Can this character gather this node RIGHT NOW? Reads the equipped gather tool + job level against the node's
 * on-chain job + tier. `{ ok:true }` when `gathering::gather` would pass; else a requirement to render on a
 * muted [G]: `reason:'tool'` (no/wrong tool for the node's job) or `reason:'tier'` (job level below the tier's
 * unlock level — `level` is the REQUIRED level).
 * @param {any} character the read-model character (carries the equipped tool slots + per-job xp `jobs`)
 * @param {{ job?: number, tier?: number } | null | undefined} target the gather_target (node job u8 + tier u8)
 * @returns {GatherGate}
 */
export function gather_gate(character, target) {
  const req_job = GATHER_JOBS[Number(target?.job) || 0] ?? GATHER_JOBS[0]
  const tool_job = job_from_tool(equipped_gather_tool(character))
  if (!tool_job || tool_job.id !== req_job.id) {
    return { ok: false, reason: 'tool', tool: req_job.tool, job: req_job.label, level: 0 }
  }
  const req_level = tier_to_level(Number(target?.tier) || 1)
  const { level } = job_level_progress(character?.jobs?.[req_job.id] ?? 0)
  if (level < req_level) {
    return { ok: false, reason: 'tier', tool: req_job.tool, job: req_job.label, level: req_level }
  }
  return { ok: true }
}
