import { EventEmitter } from 'events'

import mineflayer from 'mineflayer'
import move from 'mineflayer-move'

import logger from '../logger.js'

import { State } from './tests/test_options.js'
import connected from './tests/connected.js'
import message from './tests/message.js'

const log = logger(import.meta)

const makeid = (length) => {
  let text = ''
  const possible = '0123456789'

  for (let i = 0; i < length; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length))
  }

  return text
}

const test_list = new Set()
test_list.add(connected)
test_list.add(message)

const events = new EventEmitter()
const bot = mineflayer.createBot({ username: '#iRobot' + makeid(5) })
move(bot)

// @ts-ignore
bot.to_test = new Set()

export default {
  /**
   * @param {string[]} args
   */
  execute(...args) {
    log.info('Executing bot test')
    for (const test of test_list) {
      if (args.includes(test.name)) {
        // @ts-ignore
        bot.to_test.add(test)

        test.add_test(bot, events, log)
        log.info(`Test ${test.name} Loaded ! `)
      }
    }
    log.info(args, 'Liste des tests : ')

    bot.on('kicked', log.info)
    bot.on('error', (err) => log.info(err))

    events.on('completed', (test) => {
      log.info(`Test ${test.name} passed succesfully !`)
      // @ts-ignore
      for (const testl of bot.to_test) {
        if (testl.completed !== State.COMPLETED) return
      }
      log.info('All test passed succesfully, disconnecting')
      bot.quit()
    })

    events.on('failed', (test) => {
      log.error(`Test ${test.name} failed with error ${test.error}`)
    })
  },
}
