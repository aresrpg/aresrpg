// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// <reference types="vite/client" />

// Compile-time constants injected by vite `define` (vite.config.ts). Declared here so the typed build (tsc)
// resolves them like any global rather than erroring "Cannot find name".
declare const __APP_VERSION__: string
declare const __GIT_SHA__: string

declare module 'virtual:pwa-register' {
  export function registerSW(options?: {
    onRegisteredSW?: (swUrl: string, registration: ServiceWorkerRegistration | undefined) => void
    onOfflineReady?: () => void
    onRegisterError?: (error: Error) => void
  }): (reloadPage?: boolean) => Promise<void>
}
