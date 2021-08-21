const { ONLINE_MODE = 'false', USE_PERSISTENT_STORAGE = 'false' } = process.env

const booleanify = variable => variable?.toLowerCase() === 'true'

export const version = '1.16.3'
export const online_mode = booleanify(ONLINE_MODE)
export const use_persistent_storage = booleanify(USE_PERSISTENT_STORAGE)
