// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The site's admin page, for the admin address alone: the dashboard on the window's whole width, with the
// treasury wallet's connection in its head.
import type { AppCopy } from '../i18n/copy.ts'

import { AdminWalletControl } from './AdminWalletControl.tsx'
import { OverviewPage } from './OverviewPage.tsx'
import './admin.css'

const AdminPage = ({ copy }: Readonly<{ copy: AppCopy }>) => (
  <section className="admin-page">
    <header className="admin-page-head">
      <h1>{copy.admin}</h1>
      <AdminWalletControl />
    </header>
    <OverviewPage copy={copy.admin_page} />
  </section>
)

export default AdminPage
