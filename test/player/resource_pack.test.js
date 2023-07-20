import assert from 'assert'
import { once } from 'events'
import test from 'node:test'

import { createBot } from 'mineflayer'

import { create_server } from '../../src/server.js'
import { VERSION } from '../../src/settings.js'

test('The resource pack', async ctx => {
  ctx.beforeEach(sub_ctx => {
    sub_ctx.server = create_server()
  })

  ctx.afterEach(sub_ctx => {
    console.log('after each ======--------')
    sub_ctx.server.close()
  })

  await ctx.test(
    'should be accepted or the player will be kicked',
    async sub_ctx => {
      const bot = createBot({
        host: 'localhost',
        version: VERSION,
        username: 'bob_le_bricoleur',
      })

      await once(bot, 'resourcePack')

      const [server_client] = Object.values(sub_ctx.server.clients)
      const kicked = once(bot, 'kicked')

      bot.denyResourcePack()

      await assert.doesNotReject(kicked)

      // as the socket was already destroyed by the kick event
      // we clear the closeTimer
      // see https://github.com/PrismarineJS/node-minecraft-protocol/pull/662
      clearTimeout(server_client.closeTimer)
    },
  )
})
