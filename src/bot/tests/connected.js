import { State } from './test_options.js'
export default {
  name: 'connected',
  completed: State.PENDING,
  error: '',
  add_test(bot, events, log) {
    bot.on('spawn', () => {
      log.info({ username: bot.username, version: bot.version }, 'Spawned')
      this.completed = State.COMPLETED
      events.emit('completed', this)
    })
  },
}
