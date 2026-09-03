// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Operator-only bearer-card export. One atomic zkSend transaction locks the selected vouchers;
// only its certified success marks the private manifest live. Never commit the output folder.

import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

import { zksend } from '@mysten/zksend'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography'
import { SuiGrpcClient } from '@mysten/sui/grpc'
import QRCode from 'qrcode'
import sharp from 'sharp'

import { giftcard_id } from '../packages/sdk/src/seed_ids.ts'

const ROOT = resolve(import.meta.dir, '..')
const CARD_WIDTH = 1_004
const CARD_HEIGHT = 650
const CARD_DENSITY = 300
const usage = `Usage:
  ARESRPG_OPERATOR_PRIVATE_KEY=suiprivkey... bun run giftcards:export -- \\
    --network <testnet|mainnet> --item-type sui_crate --count 100 \\
    --claim-origin https://aresrpg.world --output giftcard-exports/sui-crates --execute

The command creates live bearer links and refuses to overwrite an existing output directory.`

export const parse_export_args = (argv) => {
  if (argv.includes('--help')) return Object.freeze({ help: true })
  const execute = argv.includes('--execute')
  const paired = argv.filter((value) => value !== '--execute')
  const entries = option_entries(paired)
  const values = (option) => entries.filter(([key]) => key === option).map(([, value]) => value)
  const options = {
    help: false,
    execute,
    network: values('--network').at(-1) ?? 'testnet',
    item_type: values('--item-type').at(-1) ?? 'sui_crate',
    claim_origin: values('--claim-origin').at(-1),
    output: values('--output').at(-1),
    count: Number(values('--count').at(-1) ?? 100),
  }
  validate_export_options(options, entries)
  return Object.freeze(options)
}

const option_entries = (paired) => {
  if (paired.length % 2 !== 0) throw new TypeError(`every option needs a value\n${usage}`)
  return Array.from({ length: paired.length / 2 }, (_, index) => [paired[index * 2], paired[index * 2 + 1]])
}

const validate_claim_origin = (origin) => {
  if (!origin || !/^https:\/\/[^/]+$/u.test(origin))
    throw new TypeError('--claim-origin must be an HTTPS origin without a path')
}

const validate_count = (count) => {
  if (!Number.isSafeInteger(count) || count < 1) throw new TypeError('--count must be a positive integer')
}

const validate_export_options = (options, entries) => {
  const allowed = new Set(['--network', '--item-type', '--count', '--claim-origin', '--output'])
  const unknown = entries.find(([key]) => !allowed.has(key))
  if (unknown) throw new TypeError(`unknown option ${unknown[0]}\n${usage}`)
  if (!['testnet', 'mainnet'].includes(options.network)) throw new TypeError('--network must be testnet or mainnet')
  validate_claim_origin(options.claim_origin)
  if (!options.output) throw new TypeError(`--output is required\n${usage}`)
  validate_count(options.count)
  if (!options.execute)
    throw new TypeError(`--execute is required because this command creates live zkSend links\n${usage}`)
}

const escape_xml = (value) =>
  String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')

const card_background = (serial, count) =>
  Buffer.from(`<svg width="${CARD_WIDTH}" height="${CARD_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
  <rect width="100%" height="100%" fill="#090711"/>
  <rect x="18" y="18" width="968" height="614" fill="none" stroke="#c8963c" stroke-width="5"/>
  <path d="M40 110 H560" stroke="#48cfcf" stroke-width="2" opacity=".55"/>
  <text x="58" y="77" fill="#48cfcf" font-family="JetBrains Mono,monospace" font-size="22" letter-spacing="7">ARESRPG · GIFT</text>
  <text x="58" y="142" fill="#f4e7bd" font-family="JetBrains Mono,monospace" font-size="42" font-weight="700">SUI CRATE</text>
  <text x="58" y="505" fill="#b5adbf" font-family="JetBrains Mono,monospace" font-size="19">SCAN TO CLAIM THE VOUCHER</text>
  <text x="58" y="540" fill="#b5adbf" font-family="JetBrains Mono,monospace" font-size="19">REDEEM IN ARESRPG · AIRDROPS</text>
  <text x="58" y="595" fill="#c8963c" font-family="JetBrains Mono,monospace" font-size="18">CARD ${escape_xml(String(serial).padStart(3, '0'))} / ${escape_xml(String(count).padStart(3, '0'))}</text>
  <rect x="584" y="114" width="370" height="420" fill="#f8f6f0"/>
  <text x="769" y="570" text-anchor="middle" fill="#c8963c" font-family="JetBrains Mono,monospace" font-size="15">ONE-TIME BEARER CODE</text>
</svg>`)

export const render_giftcard = async ({ url, serial, count, icon, output }) => {
  const [qr, crate] = await Promise.all([
    QRCode.toBuffer(url, { errorCorrectionLevel: 'H', margin: 4, width: 340, type: 'png' }),
    sharp(icon)
      .resize({ width: 340, height: 300, fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer(),
  ])
  await sharp(card_background(serial, count), { density: CARD_DENSITY })
    .resize(CARD_WIDTH, CARD_HEIGHT)
    .composite([
      { input: crate, left: 120, top: 175 },
      { input: qr, left: 599, top: 129 },
    ])
    .png()
    .withMetadata({ density: CARD_DENSITY })
    .toFile(output)
  await chmod(output, 0o600)
}

const record = (value) => (typeof value === 'object' && value !== null ? value : {})
const field = (value, key) => Reflect.get(record(value), key)

const address_owner = (owner) => {
  const row = record(owner)
  const value =
    field(row, 'AddressOwner') || field(row, 'addressOwner') || field(row, 'Address') || field(row, 'address')
  return typeof value === 'string' ? value.toLowerCase() : null
}

const load_json = async (path) => JSON.parse(await readFile(path, 'utf8'))

const custody_keypair = () => {
  const encoded = process.env.ARESRPG_OPERATOR_PRIVATE_KEY
  if (!encoded) throw new Error('ARESRPG_OPERATOR_PRIVATE_KEY is required')
  const decoded = decodeSuiPrivateKey(encoded)
  if (decoded.scheme !== 'ED25519') throw new Error('the giftcard exporter currently requires an Ed25519 operator key')
  return Ed25519Keypair.fromSecretKey(decoded.secretKey)
}

const assert_owned_cards = async (client, ids, custody) => {
  const pages = Array.from({ length: Math.ceil(ids.length / 50) }, (_, index) => ids.slice(index * 50, index * 50 + 50))
  const results = await Promise.all(pages.map((object_ids) => client.core.getObjects({ objectIds: object_ids })))
  const objects = results.flatMap((result) => result.objects)
  if (objects.length !== ids.length) throw new Error(`expected ${ids.length} giftcards, read ${objects.length}`)
  objects.forEach((object, index) => {
    if (object instanceof Error) throw object
    if (object.objectId !== ids[index]) throw new Error(`giftcard lookup order drifted at ${ids[index]}`)
    if (address_owner(object.owner) !== custody) throw new Error(`${ids[index]} is not owned by custody ${custody}`)
  })
}

const distribution_config = (pins, network) => {
  const deployment = pins[network]
  const content_root = field(field(deployment, 'content_root'), 'id')
  const game_original = field(deployment, 'package_original')
  if (!content_root || !game_original) throw new Error(`${network} distribution is not published`)
  return Object.freeze({ content_root, game_original })
}

const selected_cards = (authored, options) => {
  const rows = authored.giftcards.filter(({ item_type }) => item_type === options.item_type).slice(0, options.count)
  if (rows.length !== options.count)
    throw new Error(`authored ${rows.length}/${options.count} ${options.item_type} giftcards`)
  return rows
}

export const assert_custody = (signer, rows) => {
  const custody = signer.toSuiAddress().toLowerCase()
  if (rows.some(({ custody: authored }) => authored.toLowerCase() !== custody))
    throw new Error('operator key does not control every selected giftcard custody address')
  return custody
}

export const claim_url = (origin, zk_send_url) => {
  const source = new URL(zk_send_url)
  if (!source.hash.startsWith('#$')) throw new Error('zkSend created a link without a bearer fragment')
  const network = source.searchParams.get('network')
  const query = network === 'testnet' ? '?network=testnet' : ''
  return `${origin}/gift${query}${source.hash}`
}

const execute_links = async (client, signer, links, manifest, manifest_path) => {
  const transaction = await client.zksend.createLinks({ links })
  const result = await client.signAndExecuteTransaction({ transaction, signer, include: { effects: true } })
  if (result.$kind === 'Transaction') return result.Transaction.digest
  const { digest } = result.FailedTransaction
  await writeFile(manifest_path, `${JSON.stringify({ ...manifest, status: 'failed', digest }, null, 2)}\n`)
  throw new Error(`giftcard link transaction failed: ${digest}`)
}

export const export_giftcards = async (options) => {
  const [pins, authored] = await Promise.all([
    load_json(resolve(ROOT, 'pins.json')),
    load_json(resolve(ROOT, 'seed/content/airdrop.json')),
  ])
  const config = distribution_config(pins, options.network)
  const rows = selected_cards(authored, options)
  const signer = custody_keypair()
  const custody = assert_custody(signer, rows)
  const ids = rows.map(({ id }) => giftcard_id(config.content_root, config.game_original, id))
  const client = new SuiGrpcClient({
    network: options.network,
    baseUrl: `https://fullnode.${options.network}.sui.io:443`,
  }).$extend(zksend())
  await assert_owned_cards(client, ids, custody)
  const links = ids.map((id) => {
    const link = client.zksend.linkBuilder({ sender: custody })
    link.addClaimableObject(id)
    return link
  })
  const cards = links.map((link, index) => ({
    serial: index + 1,
    giftcard: ids[index],
    url: claim_url(options.claim_origin, link.getLink()),
    image: `${String(index + 1).padStart(3, '0')}.png`,
  }))
  const output = resolve(ROOT, options.output)
  const export_root = resolve(ROOT, 'giftcard-exports')
  if (!output.startsWith(`${export_root}/`)) throw new Error('--output must stay inside giftcard-exports/')
  await mkdir(dirname(output), { recursive: true, mode: 0o700 })
  await mkdir(output, { recursive: false, mode: 0o700 })
  const manifest_path = resolve(output, 'manifest.json')
  const manifest = { status: 'prepared', network: options.network, item_type: options.item_type, custody, cards }
  await writeFile(manifest_path, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  const icon = resolve(ROOT, `seed/icons/items/${options.item_type}_hd.png`)
  await Promise.all(
    cards.map((card) => render_giftcard({ ...card, count: cards.length, icon, output: resolve(output, card.image) }))
  )
  const digest = await execute_links(client, signer, links, manifest, manifest_path)
  const live = { ...manifest, status: 'live', digest }
  await writeFile(manifest_path, `${JSON.stringify(live, null, 2)}\n`)
  return Object.freeze({ output, digest, count: cards.length })
}

if (import.meta.main) {
  const options = parse_export_args(process.argv.slice(2))
  if (options.help) console.log(usage)
  else console.log(JSON.stringify(await export_giftcards(options)))
}
