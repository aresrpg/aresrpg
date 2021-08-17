const { ONLINE_MODE = 'false', PERSIST_STORAGE = 'false' } = process.env

const enabled = (variable) => variable?.toLowerCase() === 'true'

export const version = '1.16.3'
export const online_mode = enabled(ONLINE_MODE)
export const persist_storage = enabled(PERSIST_STORAGE)
