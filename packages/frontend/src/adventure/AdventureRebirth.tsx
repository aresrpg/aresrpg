// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { NativeModal } from '@aresrpg/ui'

import type { AppCopy } from '../i18n/copy.ts'

import './rebirth.css'

/** Presentation starts only after the terminal fight's animation queue has drained. */
export const AdventureRebirth = ({ copy }: Readonly<{ copy: AppCopy }>) => (
  <NativeModal close={null} label={copy.adventure.rebirth_title!} className="adventure-rebirth">
    <div className="adventure-rebirth__soul" aria-hidden="true" />
    <article className="adventure-rebirth__card">
      <h1>{copy.adventure.rebirth_title}</h1>
      <p>{copy.adventure.rebirth_body}</p>
      <a href="/?from=gobadoc" className="adventure-rebirth__login">
        {copy.adventure.rebirth_login}
      </a>
    </article>
  </NativeModal>
)
