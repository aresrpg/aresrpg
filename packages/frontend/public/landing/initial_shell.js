// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Parser-blocking, first-party shell selection runs before the async application entry.
/* eslint-disable fp-law/no-module-scope-effects -- This classic parser-blocking script is the document startup edge. */
// Templates are inert: landing visits never display or fetch the game postcard.
{
  const path = location.pathname.replace(/\/+$/, '')
  const root = document.getElementById('root')
  const shell = document.getElementById(path === '' ? 'boot-landing' : 'boot-game')
  // Docs, the web dapp, the KARES page and Connect Your Agent have no world to load: they never show the
  // game postcard while their entry starts.
  const agent_entry =
    path === '/connect-agent' || new URLSearchParams(location.search).get('intent') === 'connect-agent'
  const engine_less =
    path === '/docs' || path.startsWith('/docs/') || path === '/dapp' || path === '/kares' || agent_entry
  // An engine-less page shows its own shell at once, in its mood, with skeletons where its content will load.
  const light = document.getElementById('boot-light')
  if (root && light && engine_less && !path.startsWith('/docs')) {
    const content = light.content.cloneNode(true)
    content.firstElementChild.setAttribute('data-aura', agent_entry ? 'ember' : path === '/kares' ? 'sky' : 'moss')
    root.replaceChildren(content)
  }
  if (root && shell && path !== '/enoki' && !engine_less) {
    const content = shell.content.cloneNode(true)
    // Static buttons have no handlers; React replaces them with interactive controls after startup.
    if (path === '') {
      for (const button of content.querySelectorAll('button')) button.setAttribute('disabled', '')
    }
    root.replaceChildren(content)
  }
}
