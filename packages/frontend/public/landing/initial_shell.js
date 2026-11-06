// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Parser-blocking, first-party shell selection runs before the async application entry.
/* eslint-disable fp-law/no-module-scope-effects -- This classic parser-blocking script is the document startup edge. */
// Templates are inert: landing visits never display or fetch the game postcard.
{
  const path = location.pathname.replace(/\/+$/, '')
  const root = document.getElementById('root')
  const shell = document.getElementById(path === '' ? 'boot-landing' : 'boot-game')
  if (root && shell && path !== '/enoki') root.replaceChildren(shell.content.cloneNode(true))
}
