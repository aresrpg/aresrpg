// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { MonitorUp } from 'lucide-react'

import type { AppCopy } from '../i18n/copy.ts'

import './mobile_unavailable.css'

export const MOBILE_VIEWPORT_QUERY = '(max-width: 1023px)'

export const MobileUnavailableScreen = ({ copy }: Readonly<{ copy: AppCopy }>) => (
  <main className="mobile-unavailable" data-mobile-unavailable>
    <section className="mobile-unavailable__panel">
      <div aria-hidden="true" className="mobile-unavailable__emblem">
        <div className="mobile-unavailable__orbit mobile-unavailable__orbit--outer" />
        <div className="mobile-unavailable__orbit mobile-unavailable__orbit--inner" />
        <div className="mobile-unavailable__logo-frame">
          <img src="/logo.png" alt="" />
        </div>
      </div>

      <p className="mobile-unavailable__label">
        <span aria-hidden="true" />
        {copy.mobile_unavailable_label}
        <span aria-hidden="true" />
      </p>
      <h1>{copy.mobile_unavailable_title}</h1>
      <p className="mobile-unavailable__body">{copy.mobile_unavailable_body}</p>

      <div className="mobile-unavailable__status">
        <MonitorUp aria-hidden="true" size={17} strokeWidth={1.5} />
        <span>{copy.mobile_unavailable_status}</span>
        <i aria-hidden="true" />
      </div>
    </section>
  </main>
)
