// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { EngineIssue } from '@aresrpg/engine'

import type { AppCopy } from '../i18n/copy.ts'

export type GraphicsHelpKey = keyof AppCopy['graphics_help']
type Platform = 'ios' | 'android' | 'mac' | 'windows' | 'linux' | 'other'

/** First stable Firefox release shipping WebGPU, per platform (MDN, 2026). Earlier builds expose a broken flag. */
const FIREFOX_WEBGPU: Partial<Record<Platform, number>> = { mac: 147, windows: 142 }

const platform_of = (user_agent: string): Platform => {
  if (/iPhone|iPad|iPod/.test(user_agent)) return 'ios'
  if (/Android/.test(user_agent)) return 'android'
  if (/Macintosh/.test(user_agent)) return 'mac'
  if (/Windows/.test(user_agent)) return 'windows'
  if (/Linux/.test(user_agent) && !/CrOS/.test(user_agent)) return 'linux'
  return 'other'
}

const firefox_topic = (version: number, platform: Platform) => {
  const required = FIREFOX_WEBGPU[platform]
  if (required === undefined) return { key: 'firefox_unsupported' as const }
  return version < required
    ? { key: 'firefox_update' as const, version, required }
    : { key: 'firefox_settings' as const }
}

/** Which browser-specific WebGPU guidance applies. Every browser on iOS is WebKit, so it follows Safari. */
export const graphics_help_topic = (
  user_agent: string
): Readonly<{ key: GraphicsHelpKey; version?: number; required?: number }> => {
  const platform = platform_of(user_agent)
  if (platform === 'ios') return { key: 'safari' }
  const firefox = /Firefox\/(\d+)/.exec(user_agent)
  if (firefox) return firefox_topic(Number(firefox[1]), platform)
  if (/Chrome\/|Chromium\/|Edg\//.test(user_agent))
    return { key: platform === 'linux' ? 'chromium_linux' : platform === 'android' ? 'other' : 'chromium' }
  return { key: /Safari\//.test(user_agent) ? 'safari' : 'other' }
}

/** One guidance line for a WebGPU failure, or null when the failure is not about browser graphics support. */
export const graphics_help = (
  issue: EngineIssue | undefined,
  copy: Pick<AppCopy, 'graphics_help'>,
  user_agent: string
): string | null => {
  if (issue?.code !== 'webgpu_unavailable' && issue?.code !== 'webgpu_initialization_failed') return null
  const { key, version, required } = graphics_help_topic(user_agent)
  return copy.graphics_help[key].replace('{version}', String(version)).replace('{required}', String(required))
}

export const browser_user_agent = (): string => (typeof navigator === 'undefined' ? '' : navigator.userAgent)
