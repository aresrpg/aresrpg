const { ONLINE_MODE = 'false' } = process.env

export const version = '1.16.4'

export const online_mode = ONLINE_MODE.toLowerCase() === 'true'
