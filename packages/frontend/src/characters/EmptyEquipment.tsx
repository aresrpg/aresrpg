// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { AgentKioskPanel } from '../agents/AgentKioskPanel.tsx'
import { useAgentKiosk } from '../agents/useAgentKiosk.ts'
import { copy_text, type AppCopy } from '../i18n/copy.ts'

/** Returning the last delegated character cannot depend on owning another character. */
export const EmptyEquipment = ({ copy }: Readonly<{ copy: AppCopy }>) => {
  const kiosk = useAgentKiosk(copy, false)
  return (
    <div className="chr-equip chr-equip--empty-agent">
      <div className="grid flex-1 place-items-center p-8 text-center">
        <p className="text-[10px] tracking-[0.2em] text-muted uppercase">
          {copy_text(copy.characters_page)('no_character')}
        </p>
      </div>
      <AgentKioskPanel kiosk={kiosk} copy={copy} disabled={false} offline={false} />
    </div>
  )
}
