// Fixture event bus — gives the listener source (`.on`) something to hang off.
export const emitter = { on: (name, cb) => cb }
