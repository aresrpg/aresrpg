// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

export type Network = 'mainnet' | 'testnet'
export type EngineQuality = 'low' | 'medium' | 'high'

export type PublicEnv = Readonly<{
  app_name: string
  app_url: string
  enoki_api_key: string
  engine_quality: EngineQuality
  google_client_id: string
  graphql_url: string
  meta_description: string
  meta_title: string
  network: Network
  sui_rpc_url: string
  social_description: string
  social_image_url: string
  server_ws_url: string
  discord_url: string
  theme_color: string
}>

const normalize_url = (value: string): string => {
  const url = new URL(value)
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error(`Unsupported app URL: ${value}`)
  return `${url.href.replace(/\/+$/, '')}/`
}

const normalize_ws_url = (value: string): string => {
  const url = new URL(value)
  if (url.protocol !== 'wss:' && url.protocol !== 'ws:') throw new Error(`Unsupported server WebSocket URL: ${value}`)
  return `${url.href.replace(/\/+$/, '')}/`
}

export const resolve_env = (source: Readonly<Record<string, string | undefined>>): PublicEnv => {
  const {
    VITE_APP_URL = 'https://aresrpg.world/',
    VITE_ENOKI_API_KEY = 'enoki_public_ff89078fe8efa82d3f14732264813b91',
    VITE_ENGINE_QUALITY = 'medium',
    VITE_GOOGLE_CLIENT_ID = '263863163058-qn6qhkjmdvmlj8f1n4r0kdi4e608usbo.apps.googleusercontent.com',
    VITE_NETWORK = 'testnet',
    VITE_GRAPHQL_URL = `https://graphql.${VITE_NETWORK}.sui.io/graphql`,
    VITE_SUI_RPC_URL = `https://fullnode.${VITE_NETWORK}.sui.io:443`,
    VITE_SERVER_WS_URL = 'ws://localhost:9800/',
  } = source
  const network = VITE_NETWORK
  if (network !== 'mainnet' && network !== 'testnet') throw new Error(`Unsupported VITE_NETWORK: ${network}`)
  const engine_quality = VITE_ENGINE_QUALITY
  if (engine_quality !== 'low' && engine_quality !== 'medium' && engine_quality !== 'high')
    throw new Error(`Unsupported VITE_ENGINE_QUALITY: ${engine_quality}`)

  const app_url = normalize_url(VITE_APP_URL)
  return Object.freeze({
    app_name: 'AresRPG',
    app_url,
    enoki_api_key: VITE_ENOKI_API_KEY,
    engine_quality,
    google_client_id: VITE_GOOGLE_CLIENT_ID,
    graphql_url: VITE_GRAPHQL_URL,
    meta_description:
      'AresRPG is a browser-based voxel MMORPG on Sui where your characters, items, and progression live on-chain.',
    meta_title: 'AresRPG · On-chain voxel MMORPG',
    network,
    sui_rpc_url: VITE_SUI_RPC_URL,
    social_description: 'Explore a voxel world in your browser. Your characters, items, and progression live on Sui.',
    social_image_url: new URL('og-image.png', app_url).href,
    server_ws_url: normalize_ws_url(VITE_SERVER_WS_URL),
    discord_url: 'https://discord.gg/aresrpg',
    theme_color: '#0a0a0f',
  })
}

const vite_env = (import.meta as ImportMeta & { readonly env?: Record<string, string | undefined> }).env ?? {}

export const env = resolve_env(vite_env)
