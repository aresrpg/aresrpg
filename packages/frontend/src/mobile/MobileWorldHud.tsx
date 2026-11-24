// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { DesktopWorldHud } from '../components/DesktopWorldHud.tsx'
import { useAppStore } from '../store.ts'
import type { AppCopy } from '../i18n/copy.ts'

import { TouchControls } from './TouchControls.tsx'

export const MobileWorldHud = ({ copy }: Readonly<{ copy: AppCopy }>) => {
  const controls = useAppStore(
    (state) =>
      state.navigation.page === 'world' &&
      !state.navigation.dialog &&
      !state.fight.mounted &&
      state.session.selected_character_id !== null
  )
  return (
    <>
      {controls && <TouchControls copy={copy} />}
      <DesktopWorldHud copy={copy} />
    </>
  )
}
