// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

export const DemoCheckbox = ({
  checked,
  label,
  on_change,
}: Readonly<{ checked: boolean; label: string; on_change: (checked: boolean) => void }>) => (
  <label className="flex cursor-pointer items-end gap-2 pb-2 text-[7px] tracking-[0.14em] text-[#777b86] uppercase">
    {label}
    <input
      checked={checked}
      className="cursor-pointer accent-[#4a9eff]"
      onChange={(event) => on_change(event.target.checked)}
      type="checkbox"
    />
  </label>
)
