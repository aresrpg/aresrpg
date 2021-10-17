import { readFileSync } from 'fs'

import fetch from 'node-fetch'

import logger from '../../logger.js'
import {
  ENJIN_ENDPOINT,
  ENJIN_APP_ID,
  ENJIN_APP_SECRET,
} from '../../settings.js'

const log = logger(import.meta)
const headers = {
  'Content-Type': 'application/json',
}
const import_query = path => {
  const query = readFileSync(`./src/enjin/graphql/${path}.gql`, 'utf-8')
  return variables =>
    fetch(ENJIN_ENDPOINT, {
      method: 'POST',
      headers,
      body: JSON.stringify({ variables, query }),
    })
      .then(result => result.json())
      .then(({ data, errors }) => {
        if (errors) throw errors
        return data
      })
}

const Queries = {
  authenticate: import_query('authenticate'),
  create_player: import_query('create_player'),
  get_identity: import_query('get_identity'),
  get_player_infos: import_query('get_player_infos'),
  pusher: import_query('pusher'),
  mint_fungible_tokens: import_query('mint_fungible_tokens'),
}

log.info('Contacting Enjin servers..')

try {
  const {
    AuthApp: { accessToken },
  } = await Queries.authenticate({
    appId: ENJIN_APP_ID,
    appSecret: ENJIN_APP_SECRET,
  })

  log.info(
    { token: `${accessToken.slice(0, 10)}...${accessToken.slice(-10)}` },
    'Enjin app authenticated'
  )
  headers.authorization = accessToken
} catch (error) {
  log.error(error)
  // might be too harsh and the pod logs will disapear,
  // TODO: find a way too simply notify that this instance
  // wants to run with USE_BLOCKCHAIN but yet can't connect
  process.exit(1)
}

export default Queries
