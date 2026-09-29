// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { AppCopy } from '../../i18n/copy.ts'
import { dispatch_app, useAppStore } from '../../store.ts'
import { JobLevelUpView } from './JobLevelUpView.tsx'

export const JobLevelUpCard = ({ copy }: Readonly<{ copy: AppCopy }>) => {
  const level_up = useAppStore(({ job_level_up }) => job_level_up.current)
  return level_up ? (
    <JobLevelUpView copy={copy} level_up={level_up} close={() => dispatch_app({ type: 'job_level_up/acknowledged' })} />
  ) : null
}
