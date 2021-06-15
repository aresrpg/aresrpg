import { State } from './test_options.js'

export default {
  name: 'message',
  completed: State.PENDING,
  error: '',
  add_test(bot, events, log) {
    bot.on('message', () => {
      log.info('Message received')
      this.completed = State.COMPLETED
      events.emit('completed', this)
    })
  },
}
