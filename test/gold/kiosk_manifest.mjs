// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

const REMOTE_KIOSK_DEPENDENCY =
  /^\[dependencies\.Kiosk\]\r?\n(?=(?:[\w-]+\s*=\s*[^\r\n]+\r?\n)*rev\s*=\s*"[^"\r\n]+"\s*\r?\n)(?:[\w-]+\s*=\s*[^\r\n]+\r?\n)+/m

export const repoint_kiosk_dependency = (manifest) => {
  const repointed = manifest.replace(REMOTE_KIOSK_DEPENDENCY, '[dependencies.Kiosk]\nlocal = "../kiosk"\n')
  return { ok: repointed !== manifest, manifest: repointed }
}
