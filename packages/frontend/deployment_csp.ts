// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { resolve_bot_service_url } from './src/env.ts'

type Route = Readonly<{ headers?: Readonly<Record<string, string>>; [key: string]: unknown }>
type DeploymentConfig = Readonly<{ routes?: readonly Route[]; [key: string]: unknown }>
const is_csp = (key: string) => key.toLowerCase() === 'content-security-policy'
const admit_origin = (policy: string, origin: string): string => {
  const directives = policy.split(';')
  const connections = directives.filter((directive) => directive.trim().startsWith('connect-src '))
  if (connections.length !== 1) throw new Error('Expected one connect-src directive')
  const connection = connections[0]!
  const sources = connection.trim().split(/\s+/).slice(1)
  if (sources.includes("'none'")) throw new Error('Cannot extend a disabled connection policy')
  if (sources.includes(origin)) return policy
  return directives.map((directive) => (directive === connection ? `${directive} ${origin}` : directive)).join(';')
}

/** The pulled build environment owns the endpoint; only generated deployment headers receive it. */
export const with_bot_csp = <T extends DeploymentConfig>(config: T, value: string | undefined) => {
  const origin = resolve_bot_service_url(value)
  if (!origin) return config
  const routes = config.routes ?? []
  if (!routes.some((route) => Object.keys(route.headers ?? {}).some(is_csp)))
    throw new Error('Expected deployment CSP header')
  return {
    ...config,
    routes: routes.map((route) =>
      !route.headers
        ? route
        : {
            ...route,
            headers: Object.fromEntries(
              Object.entries(route.headers).map(([key, policy]) => [
                key,
                is_csp(key) ? admit_origin(policy, origin) : policy,
              ])
            ),
          }
    ),
  }
}
