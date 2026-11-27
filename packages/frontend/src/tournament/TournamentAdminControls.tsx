// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { AdminWalletControl } from '../admin/AdminWalletControl.tsx'

import { TournamentAdmin } from './TournamentAdmin.tsx'
import './admin.css'

/** The treasury wallet's connection and the tournament controls, in the header of the tournament window. */
const TournamentAdminControls = () => (
  <div className="aui-admin-controls">
    <AdminWalletControl />
    <TournamentAdmin />
  </div>
)

export default TournamentAdminControls
