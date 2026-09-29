// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { ReactNode } from 'react'

import { Button } from './controls.tsx'
import { ChoiceRail, Workspace, type ChoiceRow, type WorkspaceHeader } from './workspaces.tsx'

export const SettingsView = ({
  header,
  sections,
  selected,
  select,
  children,
  footer,
}: Readonly<{
  header: WorkspaceHeader
  sections: readonly ChoiceRow[]
  selected: string
  select: (id: string) => void
  children: ReactNode
  footer?: ReactNode
}>) => (
  <Workspace
    {...header}
    className="aui-settings"
    sidebar={<ChoiceRail rows={sections} selected={selected} select={select} />}
    footer={footer}
  >
    <div className="aui-settings-fields">{children}</div>
  </Workspace>
)

export const SettingRow = ({
  title,
  description,
  icon,
  children,
}: Readonly<{
  title: string
  description?: string
  icon?: ReactNode
  children: ReactNode
}>) => (
  <div className="aui-setting-row">
    {icon}
    <div className="aui-setting-copy">
      <strong>{title}</strong>
      {description && <p>{description}</p>}
    </div>
    <div className="aui-setting-control">{children}</div>
  </div>
)

type WalletBalance = Readonly<{ label: string; value: string; icon: ReactNode }>

export const WalletBalances = ({ balances }: Readonly<{ balances: readonly WalletBalance[] }>) => (
  <div className="aui-wallet-balances">
    {balances.map((balance) => (
      <div key={balance.label}>
        {balance.icon}
        <span>{balance.label}</span>
        <strong>{balance.value}</strong>
      </div>
    ))}
  </div>
)

export const LanguageView = ({
  header,
  languages,
  value,
  choose,
}: Readonly<{
  header: WorkspaceHeader
  languages: readonly Readonly<{ value: string; label: string; badge?: string }>[]
  value: string
  choose: (value: string) => void
}>) => (
  <Workspace {...header} className="aui-language">
    <div className="aui-language-grid">
      {languages.map((language) => (
        <Button key={language.value} aria-pressed={value === language.value} onClick={() => choose(language.value)}>
          <span className="aui-language-badge" aria-hidden="true">
            {language.badge}
          </span>
          <span>
            {language.label}
            <small>{language.value.toUpperCase()}</small>
          </span>
        </Button>
      ))}
    </div>
  </Workspace>
)
