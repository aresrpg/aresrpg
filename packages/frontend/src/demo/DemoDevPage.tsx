// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { lazy, Suspense } from 'react'

const ContentPage = import.meta.env.DEV
  ? lazy(() => import('../editor/ContentPage.tsx').then((module) => ({ default: module.ContentPage })))
  : (): null => null
const BiomePage = import.meta.env.DEV
  ? lazy(() => import('../editor/BiomePage.tsx').then((module) => ({ default: module.BiomePage })))
  : (): null => null

const Loading = ({ children }: Readonly<{ children: string }>) => (
  <div className="grid flex-1 place-items-center bg-bg text-[9px] tracking-[0.18em] text-[#c8963c] uppercase">
    {children}
  </div>
)

export const DemoDevPage = ({ view }: Readonly<{ view: string }>) => {
  if (!import.meta.env.DEV) return null
  if (view !== 'content' && view !== 'biomes') return null
  return (
    <section className="absolute inset-0 flex flex-col bg-bg pt-14">
      <Suspense fallback={<Loading>Loading seed files…</Loading>}>
        {view === 'content' ? <ContentPage /> : <BiomePage />}
      </Suspense>
    </section>
  )
}
