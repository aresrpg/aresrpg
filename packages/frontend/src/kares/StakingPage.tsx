// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The staking page: four sections behind four large tiles. Staking, the token's figures, the Mastery shop
// and the airdrops. The section is the address's hash.
import { CarvedIcon, type CarvedSymbol } from '@aresrpg/ui'
import type { ReactNode } from 'react'

import AirdropPage from '../airdrop/AirdropPage.tsx'
import { NewTabLink } from '../components/links.tsx'
import {
  SITE_ADDRESSES,
  STAKING_SECTIONS,
  staking_section_href,
  staking_section_of,
  type StakingSection,
} from '../site/routes.ts'
import { SignInStage, useSignInStage } from '../site/SignIn.tsx'
import { SiteLink } from '../site/SiteShell.tsx'
import { copy_text, type AppCopy } from '../i18n/copy.ts'
import { MasteryShop } from '../mastery/MasteryShop.tsx'
import type { SessionState } from '../modules/session.ts'
import { useSiteStore } from '../store.ts'

import StakingDesk from './StakingDesk.tsx'
import { TokenomicsSection } from './TokenomicsSection.tsx'

/** A section's tile: large enough that the eye cannot miss it, the current one lit with a gold edge. */
const TILE =
  'group flex min-h-21 min-w-0 items-center gap-3.5 rounded-ui border border-b-2 border-hair border-b-transparent bg-surface/55 px-4.5 py-3 text-muted transition-[background-color,color] duration-160 ease-ui hover:bg-surface-raised/80 hover:text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-light aria-[current=page]:border-line-strong aria-[current=page]:border-b-hue-gold aria-[current=page]:bg-linear-to-b/srgb aria-[current=page]:from-high aria-[current=page]:to-surface-raised aria-[current=page]:text-text max-[760px]:min-h-0 max-[760px]:flex-col max-[760px]:justify-center max-[760px]:gap-1.5 max-[760px]:px-0.5 max-[760px]:py-2.5 max-[760px]:text-center'

type SectionRow = Readonly<{
  icon: CarvedSymbol
  title: string
  line: string
  body: (session: SessionState) => ReactNode
}>

const sections = (copy: AppCopy): Readonly<Record<StakingSection, SectionRow>> => {
  const kares = copy.kares_page
  const mastery = copy_text(copy.mastery_page)
  const airdrop = copy_text(copy.airdrop_page)
  return {
    staking: {
      icon: 'kares',
      title: kares.tab_staking,
      line: kares.staking_line,
      body: (session) => <StakingDesk copy={copy} session={session.wallet} />,
    },
    tokenomics: {
      icon: 'stats',
      title: kares.tab_tokenomics,
      line: kares.tokenomics_line,
      body: () => <TokenomicsSection copy={kares} />,
    },
    // The daily quest is played in the world, so this section sells the shop and links to the game for it.
    mastery: {
      icon: 'mastery',
      title: mastery('title'),
      line: mastery('shop_line'),
      body: () => (
        <>
          <p className="mb-3">
            <NewTabLink className="text-orange" href={`${SITE_ADDRESSES.world}/mastery`} new_tab={copy.site.new_tab}>
              {mastery('quest_in_game')}
            </NewTabLink>
          </p>
          <MasteryShop copy={copy} />
        </>
      ),
    },
    airdrop: {
      icon: 'airdrop',
      title: airdrop('title'),
      line: airdrop('subtitle'),
      body: (session) => <AirdropPage copy={copy} session={session} />,
    },
  }
}

const SectionBody = ({ copy, row }: Readonly<{ copy: AppCopy; row: SectionRow }>) => {
  const session = useSiteStore((state) => state.session)
  // A section that signs as the game account shows a visitor its title, one sentence and the sign-in.
  const staged = useSignInStage()
  if (staged) return <SignInStage copy={copy} title={row.title} body={copy.kares_page.signin_body} />
  // The Mastery shop and the airdrop view lay out by their container's width, so the section names it.
  return <div className="aui-panel site-panel @container/aui-window">{row.body(session)}</div>
}

const StakingPage = ({ copy }: Readonly<{ copy: AppCopy }>) => {
  const section = useSiteStore((state) => staking_section_of(state.location.hash))
  const rows = sections(copy)
  return (
    <>
      <nav className="mb-4 grid grid-cols-4 gap-3 max-[760px]:gap-1.5" aria-label={copy.kares_page.tabs_label}>
        {STAKING_SECTIONS.map((key) => (
          <SiteLink key={key} className={TILE} href={staking_section_href(key)} current={key === section}>
            <CarvedIcon
              className="size-12 opacity-60 group-aria-[current=page]:opacity-100 max-[760px]:size-9"
              name={rows[key].icon}
            />
            <span className="min-w-0">
              {/* On a phone the narrower UI face keeps the longest single-word title of every language whole. */}
              <b className="block font-title text-xl/[1.1] font-semibold wrap-anywhere max-[760px]:font-ui max-[760px]:text-xs/[1.2]">
                {rows[key].title}
              </b>
              <small className="mt-1 block text-[13px]/[1.35] text-muted max-[760px]:hidden">{rows[key].line}</small>
            </span>
          </SiteLink>
        ))}
      </nav>
      <SectionBody copy={copy} row={rows[section]} />
    </>
  )
}
export default StakingPage
