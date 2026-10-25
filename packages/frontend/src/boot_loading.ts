// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { select_loading_image } from './components/loading_art.ts'

const bind_reload = (shell: Readonly<HTMLElement>): void => {
  const reload = shell.querySelector<HTMLButtonElement>('[data-loading-reload]')
  if (reload) {
    reload.removeAttribute('disabled')
    shell.setAttribute('data-boot-recovery-ready', '')
    reload.addEventListener('click', () => location.reload())
  }
}

export const prepare_boot_loading = (): void => {
  const shell = document.querySelector<HTMLElement>('[data-boot-loading]')
  if (!shell) return
  bind_reload(shell)
  const context = location.pathname.startsWith('/play-demo') || location.pathname.startsWith('/demo') ? 'demo' : 'home'
  const image = select_loading_image(context)
  shell.querySelector('[data-loading-art]')?.setAttribute('src', image)
  document.documentElement.setAttribute('data-loading-art-context', context)
  document.documentElement.setAttribute('data-loading-art', image)
  shell.setAttribute('data-loading-context', context)
  if (context !== 'demo') return
  for (const key of ['title', 'description', 'eyebrow'] as const) {
    const target = shell.querySelector(`[data-loading-${key === 'eyebrow' ? 'kicker' : key}]`)
    target?.replaceChildren(shell.getAttribute(`data-loading-demo-${key}`) ?? '')
  }
}

/** The document owns recovery until React can mount; a failed chunk cannot render a React fallback. */
export const show_boot_failure = (): void => {
  const shell = document.querySelector<HTMLElement>('[data-boot-loading]')
  if (!shell) return
  shell.setAttribute('data-world-loading', 'failed')
  const label = shell.dataset.loadingError ?? ''
  shell.setAttribute('aria-label', label)
  const message = shell.querySelector('[data-loading-status]')
  message?.replaceChildren(label)
  shell.querySelector('[data-loading-step]')?.replaceChildren()
  shell.querySelector('.world-loading-track')?.setAttribute('hidden', '')
}
