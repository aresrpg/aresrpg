// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { job_groups, type JobSlug } from '@aresrpg/immutable'

const ALL_JOBS = Object.freeze(Object.values(job_groups).flat())

export const job_from_path = (pathname: string): JobSlug => {
  const selected = new URLSearchParams(pathname.split('?')[1]?.split('#')[0] ?? '').get('job')
  return selected && ALL_JOBS.includes(selected as JobSlug) ? (selected as JobSlug) : 'FARMER'
}

export const job_path = (job: JobSlug): string => `/characters/jobs?job=${encodeURIComponent(job)}`
