import pinoPkg from 'pino'

export const log = pinoPkg({ browser: { asObject: true } })
