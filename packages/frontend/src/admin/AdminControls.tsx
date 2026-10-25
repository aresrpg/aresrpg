// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { TournamentAdmin } from '../tournament/TournamentAdmin.tsx'

import { AdminWalletControl } from './AdminWalletControl.tsx'

const AdminControls = () => (
  <div className="aui-admin-controls">
    <AdminWalletControl />
    <TournamentAdmin />
  </div>
)

export default AdminControls
