// Self-paid char-1 mint for a DEV-KEY wallet (bypasses the zkLogin sponsor). Replicates the SDK's
// character_new builder (createPersonal + api::character_new + finalize) — #51a permissionless self-pay.
// Ids come from env (mirror setup_policies.js): ARESRPG_PACKAGE_ID / ARES_ROOT / CHARACTER_POLICY / VERSION (+ optional SENDER).
// DRY_RUN=1 → dry-run as $SENDER (no key needed). EXECUTE: PRIVATE_KEY=<suiprivkey> bun run scripts/mint_char.mjs
import { KioskClient, KioskTransaction } from '@mysten/kiosk'
import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from '@mysten/sui/jsonRpc'
import { Transaction } from '@mysten/sui/transactions'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography'

const { ARESRPG_PACKAGE_ID: PKG, ARES_ROOT: ROOT, CHARACTER_POLICY: POLICY, VERSION } = process.env
if (!PKG || !ROOT || !POLICY || !VERSION)
  throw new Error('need ARESRPG_PACKAGE_ID, ARES_ROOT, CHARACTER_POLICY, VERSION')
// Dry-run sender (any funded testnet address); override via SENDER=. Not used in EXECUTE mode (derived from the key).
const SENDER = process.env.SENDER || '0x7920d7587a619112d13fe01027a591254dfd6770bb77441c8ad9b9780db6b2c5'
// char params: WINR / senshi / male / colors #ffffff,#d9af57,#8b6539 → u32 RGB
const NAME = 'WINR', CLASSE = 'senshi', MALE = true, C1 = 0xffffff, C2 = 0xd9af57, C3 = 0x8b6539

const sui = new SuiJsonRpcClient({ url: getJsonRpcFullnodeUrl('testnet'), network: 'testnet' })
const kioskClient = new KioskClient({ client: sui, network: 'testnet' })

function build(sender) {
  const tx = new Transaction()
  tx.setSender(sender)
  tx.moveCall({ target: `${PKG}::header::aresrpg` })           // #45 brand, command #1
  const kt = new KioskTransaction({ transaction: tx, kioskClient })
  kt.createPersonal(true)                                       // personal kiosk + borrow cap
  tx.moveCall({
    target: `${PKG}::api::character_new`,
    arguments: [
      kt.getKiosk(), kt.getKioskCap(), tx.object(ROOT), tx.object(POLICY),
      tx.pure.string(NAME), tx.pure.string(CLASSE), tx.pure.bool(MALE),
      tx.pure.u32(C1), tx.pure.u32(C2), tx.pure.u32(C3), tx.object(VERSION),
    ],
  })
  kt.finalize()                                                 // share kiosk + wrap/transfer PersonalKioskCap
  return tx
}

if (process.env.DRY_RUN === '1') {
  const tx = build(SENDER)
  const bytes = await tx.build({ client: sui })
  const dr = await sui.dryRunTransactionBlock({ transactionBlock: bytes })
  console.log('DRY-RUN status:', JSON.stringify(dr.effects?.status))
  console.log('created objects:', (dr.objectChanges || []).filter(c => c.type === 'created').map(c => c.objectType?.split('::').slice(-1)[0]).join(', '))
} else {
  const { secretKey } = decodeSuiPrivateKey(process.env.PRIVATE_KEY)
  const kp = Ed25519Keypair.fromSecretKey(secretKey)
  const tx = build(kp.getPublicKey().toSuiAddress())
  const r = await sui.signAndExecuteTransaction({ signer: kp, transaction: tx, options: { showEffects: true, showObjectChanges: true } })
  await sui.waitForTransaction({ digest: r.digest })
  console.log('MINT status:', r.effects?.status?.status, '| digest:', r.digest)
  console.log('Character locked in personal kiosk:', (r.objectChanges || []).some(c => /::character::Character/.test(c.objectType || '')) ? 'YES ✓' : '(check kiosk)')
}
