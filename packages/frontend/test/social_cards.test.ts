// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { loadImage } from '@napi-rs/canvas'
import { class_names } from '@aresrpg/immutable'
import { expect, test } from 'bun:test'

import deployment from '../vercel.json'
import { SOCIAL_CARD_HEIGHT, SOCIAL_CARD_WIDTH, create_social_renderer } from '../social_card_render.ts'
import { social_catalog, social_html } from '../social_cards.ts'
import { encyclopedia_route_view } from '../src/encyclopedia/EncyclopediaContent.tsx'
import { resolve_env } from '../src/env.ts'

const frontend_dir = resolve(import.meta.dir, '..')
const repo_dir = resolve(frontend_dir, '../..')
const cards_dir = resolve(repo_dir, 'seed/icons/social')
const catalog = await social_catalog({
  content_dir: resolve(repo_dir, 'seed/content'),
  copy_path: resolve(frontend_dir, 'src/i18n/locales/en.yaml'),
  icons_dir: resolve(repo_dir, 'seed/icons'),
})
const shell = readFileSync(resolve(frontend_dir, 'index.html'), 'utf8')
const authored = (image: string): string => resolve(cards_dir, image.replace('/social/', ''))

test('every shareable route owns one card whose image is authored or painted from existing art', () => {
  const routes = catalog.cards.map(({ route }) => route)
  expect(new Set(routes).size).toBe(routes.length)
  for (const card of catalog.cards) {
    if (card.entity) expect(existsSync(card.entity.art_path)).toBeTrue()
    else if (card.image !== '/social/encyclopedia.jpg') expect(existsSync(authored(card.image))).toBeTrue()
  }
  expect(catalog.encyclopedia.art_paths.length).toBeGreaterThan(0)
  expect(catalog.encyclopedia.art_paths.every((path) => existsSync(path))).toBeTrue()
})

test('entity routes are the ones the encyclopedia itself resolves', () => {
  const entities = catalog.cards.filter(({ route }) => route.split('/').length === 4)
  const tabs = new Set(entities.map(({ route }) => encyclopedia_route_view(route).tab))
  expect([...tabs].sort()).toEqual(['bestiary', 'classes', 'items'])
  for (const { route } of entities) expect(encyclopedia_route_view(route).id).toBe(route.split('/').at(-1)!)
  for (const classe of class_names)
    expect(entities.some(({ route }) => route === `/encyclopedia/classes/${classe}`)).toBeTrue()
})

test('a class without its own portrait falls back to the encyclopedia card', () => {
  const image = (classe: string) =>
    catalog.cards.find(({ route }) => route === `/encyclopedia/classes/${classe}`)?.image
  expect(image('senshi')).toBe('/social/classe/senshi.jpg')
  expect(image('yogan')).toBe('/social/encyclopedia.jpg')
})

test('a route shell swaps every preview tag and leaves the application untouched', () => {
  const card = catalog.cards.find(({ route }) => route === '/encyclopedia/items/cloudstep_greaves')!
  const html = social_html(shell, { ...card, title: 'Tom & "Jerry"' }, 'https://preview.example/game/')
  expect(html).toContain('<title>Tom &amp; &quot;Jerry&quot; · AresRPG</title>')
  expect(html).toContain(
    '<meta property="og:url" content="https://preview.example/game/encyclopedia/items/cloudstep_greaves" />'
  )
  expect(html).toContain(
    '<meta property="og:image" content="https://preview.example/game/social/item/cloudstep_greaves.jpg" />'
  )
  expect(html).toContain(`<meta name="twitter:description" content="${card.description}" />`)
  expect(html).not.toContain('{{META_TITLE}}')
  expect(html).not.toContain('{{SOCIAL_IMAGE_URL}}')
  expect(html).toContain('<script type="module" src="/src/main.tsx"></script>')
})

test('a shell that lost a preview tag fails the build instead of shipping a stale preview', () => {
  const card = catalog.cards[0]!
  expect(() =>
    social_html(shell.replace(/<meta name="twitter:image"[^>]*>/, ''), card, 'https://aresrpg.world/')
  ).toThrow('twitter:image')
})

test('painted cards are JPEGs at the declared preview size', async () => {
  const renderer = await create_social_renderer({
    font_path: resolve(repo_dir, 'packages/journal/public/assets/jetbrains-mono.woff2'),
    logo_path: resolve(repo_dir, 'seed/scenes/aresrpg_text_logo.png'),
    tokens_path: resolve(frontend_dir, 'src/tailwind.css'),
  })
  const entity = catalog.cards.find((card) => card.entity)!.entity!
  for (const bytes of [await renderer.entity(entity), await renderer.encyclopedia(catalog.encyclopedia)]) {
    expect([...bytes.slice(0, 3)]).toEqual([0xff, 0xd8, 0xff])
    const image = await loadImage(Buffer.from(bytes))
    expect([image.width, image.height]).toEqual([SOCIAL_CARD_WIDTH, SOCIAL_CARD_HEIGHT])
  }
  expect(shell).toContain(`<meta property="og:image:width" content="${SOCIAL_CARD_WIDTH}" />`)
  expect(shell).toContain(`<meta property="og:image:height" content="${SOCIAL_CARD_HEIGHT}" />`)
})

test('the home and static page previews point at authored cards the deployment never rewrites', () => {
  const home = new URL(resolve_env({ VITE_APP_URL: 'https://aresrpg.world' }).social_image_url).pathname
  const [agents, links] = ['agents', 'links'].map(
    (page) =>
      readFileSync(resolve(frontend_dir, `public/${page}/index.html`), 'utf8').match(
        /og:image" content="https:\/\/aresrpg\.world([^"]+)"/
      )![1]!
  )
  const rewrites = deployment.rewrites
    .filter(({ destination }) => destination === '/index.html')
    .map(({ source }) => new RegExp(`^${source}$`))
  for (const image of [home, agents!, links!, '/social/item/missing.jpg']) {
    expect(rewrites.some((pattern) => pattern.test(image))).toBeFalse()
    if (!image.includes('missing')) expect(existsSync(authored(image))).toBeTrue()
  }
})
