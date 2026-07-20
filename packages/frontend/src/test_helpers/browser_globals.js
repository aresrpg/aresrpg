const storage_stub = () => ({
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
})

function fake_element() {}
fake_element.prototype.closest = () => null

/** Install one complete browser-shaped test surface and return its exact descriptor restore. */
export function install_browser_globals({ with_document = false, with_element = false } = {}) {
  const keys = ['window', 'location', 'localStorage', 'requestAnimationFrame', 'cancelAnimationFrame']
  if (with_document) keys.push('document')
  if (with_element) keys.push('Element')
  const descriptors = new Map(keys.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
  const local_storage = storage_stub()
  const window_stub = {
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent: () => true,
    matchMedia: () => ({ matches: false }),
    location: { origin: 'http://localhost:5173', href: 'http://localhost:5173/', search: '' },
    localStorage: local_storage,
    setInterval: globalThis.setInterval.bind(globalThis),
    clearInterval: globalThis.clearInterval.bind(globalThis),
  }
  Object.defineProperties(globalThis, {
    window: { configurable: true, writable: true, value: window_stub },
    location: { configurable: true, writable: true, value: window_stub.location },
    localStorage: { configurable: true, writable: true, value: local_storage },
    requestAnimationFrame: { configurable: true, writable: true, value: () => 0 },
    cancelAnimationFrame: { configurable: true, writable: true, value: () => {} },
    ...(with_document
      ? {
          document: {
            configurable: true,
            writable: true,
            value: { hidden: false, addEventListener() {}, removeEventListener() {} },
          },
        }
      : {}),
    ...(with_element
      ? {
          Element: {
            configurable: true,
            writable: true,
            value: fake_element,
          },
        }
      : {}),
  })
  return () => {
    for (const key of keys) {
      const descriptor = descriptors.get(key)
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else delete globalThis[key]
    }
  }
}
