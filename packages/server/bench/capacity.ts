// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Run against a disposable, dedicated local FalkorDB. Never point this at game data.
// bun packages/server/bench/capacity.ts <redis-url> [pods=1] [accounts/pod=200] [characters=1] [seconds=30] [stagger-ms=10]
import { FalkorDB } from 'falkordb'
import { ITEM_STAT_FIELDS } from '@aresrpg/fight/move_contract'

const [
  url,
  raw_pods = '1',
  raw_accounts = '200',
  raw_characters = '1',
  raw_seconds = '30',
  raw_stagger = '10',
  chat_mode = 'spread',
] = process.argv.slice(2)
if (!url?.startsWith('redis://127.0.0.1:')) throw new Error('An isolated local Redis URL is required')
const pods = Number(raw_pods),
  accounts = Number(raw_accounts),
  characters = Number(raw_characters)
if (
  ![pods, accounts, characters, Number(raw_seconds)].every((value) => Number.isInteger(value) && value > 0) ||
  pods > 5 ||
  accounts > 200 ||
  characters > 6
)
  throw new Error('Maximum local workload: five processes, 200 accounts each, six characters/account')
const name = `capacity_${process.pid}_${Date.now()}`
const db = await FalkorDB.connect({ url })
const store = db.selectGraph(name)
const children: ReturnType<typeof Bun.spawn>[] = []
const logs: string[] = []
try {
  for (const [label, field] of [
    ['User', 'address'],
    ['Kiosk', 'id'],
    ['Character', 'id'],
    ['Character', 'owner'],
    ['Item', 'id'],
    ['Item', 'item_type'],
    ['Item', 'category'],
    ['Zone', 'world'],
  ]) {
    await store.query(`CREATE INDEX FOR (n:${label}) ON (n.${field})`)
  }
  const rows = Array.from({ length: pods * accounts }, (_, index) => ({
    address: `0x${(index + 1).toString(16).padStart(64, '0')}`,
    index,
  }))
  await store.query(
    `UNWIND $rows AS row CREATE (:User {address:row.address})-[:OWNS]->(:Kiosk {id:row.address,market_version:'1'})`,
    { params: { rows } }
  )
  const at_ms = Date.now() - 60_000
  for (const row of rows) {
    const roster = Array.from({ length: characters }, (_, index) => ({
      id: `0x${(100_000 + row.index * 6 + index).toString(16).padStart(64, '0')}`,
      name: `Crowd ${row.index}:${index}`,
    }))
    await store.query(
      `MATCH (k:Kiosk {id:$address}) UNWIND $roster AS row
      CREATE (k)-[:HOLDS]->(c:Character {id:row.id,owner:$address,name:row.name,classe:'senshi',sex:'male',level:10,
        experience:'0',world:'nauvis',checkpoint_world:'nauvis',x:50000,z:50000,at_ms:$at_ms,spells:'{}',
        color_1:0,color_2:0,color_3:0,folded_stats:$stats})
      CREATE (c)-[:EQUIPS {slot:'hat'}]->(:Item {id:row.id+'_hat',item_type:'mokan',name:'Mokan',category:'hat',level:1,amount:1,stats:$stats})
      CREATE (c)-[:EQUIPS {slot:'pet'}]->(:Item {id:row.id+'_pet',item_type:'bulbiflor',name:'Bulbiflor',category:'pet',level:1,amount:1,stats:$stats})`,
      { params: { address: row.address, roster, at_ms, stats: ITEM_STAT_FIELDS.map(() => 32768) } }
    )
  }
  await store.query("CREATE (:Zone {world:'nauvis',zx:97,zz:97,seed:'7',resources:[],mobs:[]})")
  const ports = Array.from({ length: pods }, (_, index) => 19800 + index)
  for (const port of ports) {
    const log = `/tmp/${name}_${port}.log`
    logs.push(log)
    const child = Bun.spawn(['bun', `${import.meta.dir}/capacity_server.ts`, url, name, String(port)], {
      stdout: Bun.file(log),
      stderr: Bun.file(`${log}.err`),
    })
    children.push(child)
    let ready = false
    for (let attempt = 0; attempt < 100; attempt++) {
      try {
        ready = (await fetch(`http://127.0.0.1:${port}/stats`)).ok
      } catch {
        /* Server has not bound its local port yet. */
      }
      if (ready) break
      await Bun.sleep(100)
    }
    if (!ready) throw new Error(`Local server failed; inspect ${log}.err`)
  }
  const per_driver = Number(process.env.CAPACITY_CLIENTS_PER_DRIVER ?? accounts)
  if (!Number.isInteger(per_driver) || per_driver < 1) throw new Error('Positive clients per driver required')
  const driver_groups = ports.flatMap((port, index) =>
    Array.from({ length: Math.ceil(accounts / per_driver) }, (_, shard) => ({
      port,
      start: index * accounts + shard * per_driver,
      count: Math.min(per_driver, accounts - shard * per_driver),
    }))
  )
  const drivers = driver_groups.map(({ port, start, count }) => {
    const child = Bun.spawn(
      [
        'bun',
        `${import.meta.dir}/capacity_clients.ts`,
        String(port),
        String(start),
        String(count),
        String(Number(raw_seconds) * 1000),
        raw_stagger,
        chat_mode,
      ],
      { stdout: 'pipe', stderr: 'pipe' }
    )
    children.push(child)
    return child
  })
  const clients = await Promise.all(
    drivers.map(async (driver) => {
      const [output, errors, code] = await Promise.all([
        new Response(driver.stdout).text(),
        new Response(driver.stderr).text(),
        driver.exited,
      ])
      if (code !== 0) throw new Error(`Client failed: ${errors}`)
      return JSON.parse(output)
    })
  )
  const servers = await Promise.all(ports.map(async (port) => (await fetch(`http://127.0.0.1:${port}/stats`)).json()))
  console.log(JSON.stringify({ name, pods, accounts, characters, chat_mode, clients, servers, logs }, null, 2))
} finally {
  children.forEach((child) => child.kill())
  await Promise.all(children.map((child) => child.exited))
  await store.delete()
  await db.close()
}
