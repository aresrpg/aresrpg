import { mock } from 'bun:test'

const default_state = () => ({
  address: null,
  wallet_name: null,
  is_loading: false,
  sui_balance_mist: null,
  sui_balance_read_at_ms: null,
  refresh_sui_balance: async () => {},
  login: async () => null,
  logout: async () => {},
})

const default_implementations = () => ({
  find_wallet: () => null,
  sign_and_execute_transaction: async () => ({}),
  sign_and_execute_self_pay_transaction: async () => ({}),
  submit_terminal_random_tx: async () => ({}),
  sponsor_and_execute_transaction: async () => ({}),
  get_zklogin_address_seed: async () => '',
  current_session: () => null,
})

let state = default_state()
let implementations = default_implementations()

const use_auth = (selector = (value) => value) => selector(state)
use_auth.getState = () => state
use_auth.setState = (update, replace = false) => {
  const patch = typeof update === 'function' ? update(state) : update
  state = replace ? patch : { ...state, ...patch }
}
use_auth.subscribe = () => () => {}

export const reset_auth_mock = (overrides = {}) => {
  state = { ...default_state(), ...overrides }
  implementations = default_implementations()
}

export const set_auth_mock_implementation = (name, implementation) => {
  if (!(name in implementations)) throw new Error(`Unknown auth mock implementation: ${name}`)
  implementations[name] = implementation
}

mock.module('../auth', () => ({
  ENOKI_API_KEY: 'test',
  GOOGLE_CLIENT_ID: 'test',
  SUI_NETWORK: 'testnet',
  SUI_CHAIN: 'sui:testnet',
  find_wallet: (...args) => implementations.find_wallet(...args),
  sign_and_execute_transaction: (...args) => implementations.sign_and_execute_transaction(...args),
  sign_and_execute_self_pay_transaction: (...args) => implementations.sign_and_execute_self_pay_transaction(...args),
  submit_terminal_random_tx: (...args) => implementations.submit_terminal_random_tx(...args),
  sponsor_and_execute_transaction: (...args) => implementations.sponsor_and_execute_transaction(...args),
  get_zklogin_address_seed: (...args) => implementations.get_zklogin_address_seed(...args),
  use_auth,
  current_session: (...args) => implementations.current_session(...args),
}))
