// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// ─────────────────────────────────────────────────────────────────────────────
//  redact.ts — the credential shapes that may never leave the browser (#2192)
// ─────────────────────────────────────────────────────────────────────────────
//  An auth failure's message and response body are exactly where a live id_token, a zk proof or an ephemeral
//  key gets echoed back at us, and an error store is a third party. Two scrubs, one home:
//
//  · redact_jwt — the CLASS GATE. A JWT is never legitimate diagnostic content, so report.js runs this over
//    every outbound event message, whatever produced it. This is what makes "no token reaches Sentry" a
//    property of the reporter instead of a promise each catch block has to keep.
//  · redact_auth_secrets — the stricter scrub for text lifted OFF an auth error on purpose: anything long and
//    opaque is treated as material. Too aggressive for the class gate (it would eat a tx digest, which is a
//    diagnostic we want), exactly right at the auth seam.
//
//  PURE — string in, string out.

const JWT = /\beyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}(?:\.[A-Za-z0-9_-]*)?/g
// 40 characters is comfortably above any word a human error message uses, and below every secret shape.
const OPAQUE = /[A-Za-z0-9_+/-]{40,}={0,2}/g

/** Scrub JSON Web Tokens — the one shape no error text is ever allowed to carry. PURE. */
export const redact_jwt = (text: string): string => text.replace(JWT, '[jwt]')

/** Scrub tokens AND opaque key/proof/salt material, keeping the surrounding diagnosis intact. PURE. */
export const redact_auth_secrets = (text: string): string => redact_jwt(text).replace(OPAQUE, '[redacted]')
