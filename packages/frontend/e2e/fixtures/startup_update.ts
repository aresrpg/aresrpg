// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { observe_startup_recovery, recover_missing_asset, RELOAD_CHECK } from '../../src/startup_recovery.ts'

observe_startup_recovery()
sessionStorage.setItem('fixture-visits', String(Number(sessionStorage.getItem('fixture-visits') ?? 0) + 1))
document.getElementById('missing')!.onclick = () =>
  recover_missing_asset({
    state: 'failed',
    backend: 'none',
    issue: { code: 'asset_missing', detail: 'missing city artifact' },
  })
addEventListener(RELOAD_CHECK, (event) => {
  if ((document.getElementById('busy') as HTMLInputElement).checked) event.preventDefault()
})
