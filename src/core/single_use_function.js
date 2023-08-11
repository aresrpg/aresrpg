/**
 * Creates a function that can only be called once. After its initial invocation, any
 * subsequent calls will result in an error due to a revoked proxy.
 */
export default function single_use_function(fn) {
  const { proxy, revoke } = Proxy.revocable(fn, {
    apply(target, current_this, arguments_list) {
      revoke()
      return Reflect.apply(target, current_this, arguments_list)
    },
  })
  return proxy
}
