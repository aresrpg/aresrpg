// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The KARES page of the site: the token's figures and the staking desk on one light page, with no
// world and no renderer. The 3D game shows the same staking desk in its own window.
import { SegmentedControl } from '@aresrpg/ui'
import { useEffect, useState } from 'react'

import type { AppCopy } from '../i18n/copy.ts'
import { KaresLogo } from '../components/KaresLogo.tsx'
import { LightPage, LightPageGate } from '../components/LightPage.tsx'
import { useAppStore } from '../store.ts'

import KaresPage from './KaresPage.tsx'
import { TokenomicsTab } from './TokenomicsTab.tsx'

type KaresTab = 'staking' | 'tokenomics'
/** The tab is the page's hash, so a link can open either one. Staking is the page's first tab. */
const tab_of = (hash: string): KaresTab => (hash === '#tokenomics' ? 'tokenomics' : 'staking')

/** Staking signs as the game account, so it asks for the one sign-in first. */
const StakingDesk = ({ copy }: Readonly<{ copy: AppCopy }>) => {
  const wallet = useAppStore(({ session }) => session.wallet)
  if (wallet)
    return (
      <div className="aui-panel light-page-panel">
        <KaresPage copy={copy} initial_session={wallet} />
      </div>
    )
  return <LightPageGate copy={copy} title={copy.kares_page.signin_title} body={copy.kares_page.signin_body} />
}

export const KaresRoute = ({ copy }: Readonly<{ copy: AppCopy }>) => {
  const [tab, set_tab] = useState<KaresTab>(() => tab_of(globalThis.location.hash))
  useEffect(() => {
    const sync = (): void => set_tab(tab_of(globalThis.location.hash))
    addEventListener('hashchange', sync)
    return () => removeEventListener('hashchange', sync)
  }, [])
  const text = copy.kares_page
  return (
    <LightPage
      copy={copy}
      aura="sky"
      brand={
        <>
          <KaresLogo size={22} />
          <strong>AresRPG</strong>
          <span>KARES</span>
        </>
      }
      controls={
        <SegmentedControl<KaresTab>
          label={text.tabs_label}
          value={tab}
          on_change={(next) => globalThis.location.assign(`#${next}`)}
          options={[
            { value: 'staking', label: text.tab_staking },
            { value: 'tokenomics', label: text.tab_tokenomics },
          ]}
        />
      }
    >
      {tab === 'staking' ? (
        <StakingDesk copy={copy} />
      ) : (
        <div className="aui-panel light-page-panel">
          <TokenomicsTab copy={text} />
        </div>
      )}
    </LightPage>
  )
}
