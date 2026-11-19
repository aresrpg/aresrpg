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
  const context = location.pathname.startsWith('/demo') ? 'demo' : 'home'
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

/** The engine-less shell of the document, shown while a light page's code loads. Its mood follows the page. */
export const show_light_shell = (aura: 'sky' | 'ember' | 'moss'): void => {
  const host = document.getElementById('root')
  const template = document.getElementById('boot-light') as HTMLTemplateElement | null
  if (!host || !template) return
  const content = template.content.cloneNode(true) as DocumentFragment
  content.firstElementChild?.setAttribute('data-aura', aura)
  host.replaceChildren(content)
}

/** Restore the document-owned postcard when leaving the landing or recovering a failed import. */
export const show_boot_loading = (): void => {
  const host = document.getElementById('root')
  const template = document.getElementById('boot-game') as HTMLTemplateElement | null
  if (!host || !template) throw new Error('Game loading shell is missing')
  host.replaceChildren(template.content.cloneNode(true))
  prepare_boot_loading()
}

/** The document owns recovery until React can mount; a failed chunk cannot render a React fallback. */
export const show_boot_failure = (): void => {
  if (!document.querySelector('[data-boot-loading]')) show_boot_loading()
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
