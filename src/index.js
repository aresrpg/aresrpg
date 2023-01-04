import observe_performance from './performance.js'
import { create_server } from './server.js'

process.on('unhandledRejection', error => {
  throw error
})

create_server()
observe_performance()
