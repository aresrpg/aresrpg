// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The site's one sign-in control, and where it stands. A view about the account holds it in the page while nobody is
// signed in, and the bar then shows none; every other page keeps it in the bar. Only one is ever on screen.
import { Button } from '@aresrpg/ui'
import type { LucideIcon } from 'lucide-react'

import { GoogleIcon } from '../components/GoogleLoginButton.tsx'
import type { AppCopy } from '../i18n/copy.ts'
import { dispatch_app, useSiteStore } from '../store.ts'

import { is_account_view } from './routes.ts'

/** Whether the page on screen holds the sign-in: a view about the account while nobody is signed in. */
export const useSignInStage = (): boolean =>
  useSiteStore(({ session, location }) => !session.wallet && is_account_view(location))

/** The bar's flat key, or the page's bone key. It keeps its box while a sign-in runs; a failure is a toast. */
const SIGN_IN = {
  bar: 'site-sign-in',
  stage:
    'mt-3 h-11 min-h-11 gap-2.5 rounded-[5px] border-gold-light/70 bg-gold-light px-5 text-[15px] font-extrabold text-(--aui-brass-ink) shadow-none [text-shadow:none] max-[600px]:w-full',
} as const

export const SignIn = ({ copy, stage = false }: Readonly<{ copy: AppCopy | null; stage?: boolean }>) => {
  const ready = useSiteStore(({ session }) => session.wallets !== null)
  const busy = useSiteStore(({ session }) => session.sign_in.status === 'connecting')
  const icon = stage ? (
    <span className="-ml-1.5 grid size-6 place-items-center rounded-[3px] bg-text">
      <GoogleIcon />
    </span>
  ) : (
    <GoogleIcon />
  )
  return (
    <Button
      className={SIGN_IN[stage ? 'stage' : 'bar']}
      busy={busy}
      disabled={!ready || !copy}
      onClick={() => dispatch_app({ type: 'auth/login_google' })}
    >
      {!busy && icon}
      {(stage ? copy?.continue_google : copy?.site.login) ?? <span className="aui-skeleton site-stub" />}
    </Button>
  )
}

export type StageFact = Readonly<{ icon: LucideIcon; title: string; body: string }>

/** A divider between two facts: a fading upright line, or a fading hairline above a fact once they stack. */
const FACT =
  'relative grid content-start gap-1.5 px-6 py-1 not-first:before:absolute not-first:before:inset-y-0 not-first:before:left-0 not-first:before:w-px not-first:before:bg-[linear-gradient(180deg,transparent,var(--aui-line-strong)_25%,var(--aui-line-strong)_75%,transparent)] max-[600px]:grid-cols-[24px_minmax(0,1fr)] max-[600px]:gap-x-3 max-[600px]:gap-y-0.5 max-[600px]:px-0 max-[600px]:py-3 max-[600px]:not-first:before:right-0 max-[600px]:not-first:before:bottom-auto max-[600px]:not-first:before:h-px max-[600px]:not-first:before:w-auto max-[600px]:not-first:before:bg-[linear-gradient(90deg,transparent,var(--aui-hair)_10%,var(--aui-hair)_90%,transparent)]'

/**
 * What a view about the account shows a visitor, centred on the page's ground: the helmet rising out of a fading line,
 * what the page is, the one sign-in, and what the page holds once signed in.
 */
export const SignInStage = ({
  copy,
  title,
  body,
  facts = [],
}: Readonly<{ copy: AppCopy; title: string; body: string; facts?: readonly StageFact[] }>) => (
  <section className="mx-auto mt-13.5 grid max-w-230 justify-items-center gap-3.5 text-center max-[600px]:mt-6 max-[600px]:gap-2.5">
    <span
      aria-hidden="true"
      className="relative h-23 w-65 bg-[linear-gradient(90deg,transparent,var(--aui-line-strong)_18%,var(--aui-line-strong)_82%,transparent)] bg-size-[100%_1px] bg-bottom bg-no-repeat [clip-path:inset(-80px_-40px_0_-40px)] max-[600px]:h-17.5 max-[600px]:w-50"
    >
      <img
        className="absolute -bottom-8.5 left-1/2 size-34 max-w-none -translate-x-1/2 max-[600px]:-bottom-6.5 max-[600px]:size-26"
        src="/logo-192.png"
        alt=""
        width={136}
        height={136}
      />
    </span>
    <h1 className="mt-2.5 font-title text-[42px]/[1.1] font-bold tracking-[-0.015em] text-balance max-[600px]:text-[26px]">
      {title}
    </h1>
    <p className="max-w-[52ch] text-[17px]/normal text-muted max-[600px]:text-[15px]">{body}</p>
    <SignIn copy={copy} stage />
    {facts.length > 0 && (
      <ul className="mt-11 grid w-full grid-cols-3 text-left max-[600px]:mt-5.5 max-[600px]:grid-cols-1">
        {facts.map(({ icon: Icon, title: name, body: line }) => (
          <li key={name} className={FACT}>
            <Icon className="text-gold max-[600px]:row-span-2 max-[600px]:mt-px" size={20} aria-hidden="true" />
            <b className="text-[15px]/[1.3] font-extrabold">{name}</b>
            <span className="text-[13px]/normal text-muted">{line}</span>
          </li>
        ))}
      </ul>
    )}
  </section>
)
