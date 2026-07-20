/**
 * Models zustand stores for the FP-constitution queries (docs/CODE_LAW.md L-P4):
 * store creation (`create` / `createStore`, direct or curried, middleware-wrapped), the setter
 * values (`set` initializer parameter, `store.setState`) tracked through helper arguments and
 * module boundaries, and the sanctioned action surface — the "doors" (properties of the object
 * the initializer returns, including maker-built actions like `input: make_input(set, get)`).
 * Every model also exists store-INDEXED (keyed by the creation call node) so cross-store
 * queries (dual-home-store-copy) can tell one store's surface from another's; the arity-0/1
 * forms are the any-store projections. `state_read` / `door_call` model the read and dispatch
 * surfaces.
 *
 * Identification is dataflow/type-tracking based, never name-matching: a local function named
 * `set`, `Map.prototype.set`, or React's `this.setState` do NOT match by construction.
 */

import javascript

module Zustand {
  /** The `create`/`createStore` function value imported from zustand. */
  private DataFlow::SourceNode create_fn() {
    result =
      DataFlow::moduleMember(["zustand", "zustand/vanilla", "zustand/traditional", "zustand/react"],
        ["create", "createStore", "createWithEqualityFn"])
    or
    result = DataFlow::moduleImport(["zustand", "zustand/vanilla"])
  }

  /**
   * A store-creating call carrying the initializer: `create(init)`, `createStore(init)`, or the
   * curried TS form `create<T>()(init)` (the zero-argument base call's result invoked). A hook
   * call like `use_store(selector)` never matches: its base call already carries an argument.
   * This call node IS the store's identity for every store-indexed predicate below.
   */
  DataFlow::CallNode store_create_call() {
    exists(result.getArgument(0)) and
    (
      result = create_fn().getACall()
      or
      exists(DataFlow::CallNode base |
        base = create_fn().getACall() and not exists(base.getArgument(0))
      |
        result = base.getACall()
      )
    )
  }

  /**
   * A dataflow position holding the initializer of the store created at `s`: `create(HERE)`,
   * unwrapped through middleware wrappers (`devtools(persist(HERE))` — zustand middleware takes
   * the initializer as its first argument).
   */
  private DataFlow::Node initializer_pos(DataFlow::CallNode s) {
    s = store_create_call() and result = s.getArgument(0)
    or
    exists(DataFlow::CallNode middleware | middleware.flowsTo(initializer_pos(s)) |
      result = middleware.getArgument(0)
    )
  }

  /** The initializer function `(set, get, api) => state` of the store created at `s`. */
  DataFlow::FunctionNode initializer(DataFlow::CallNode s) {
    result = initializer_pos(s).getAFunctionValue()
  }

  /** The store initializer function `(set, get, api) => state` (any store). */
  DataFlow::FunctionNode initializer() { result = initializer(_) }

  /** The store object of `s`, type-tracked across returns, exports, and imports. */
  private DataFlow::SourceNode store_obj(DataFlow::TypeTracker t, DataFlow::CallNode s) {
    t.start() and result = s and s = store_create_call()
    or
    exists(DataFlow::TypeTracker t2 | result = store_obj(t2, s).track(t2, t))
  }

  /** The store object (hook or vanilla store) created at `s`. */
  DataFlow::SourceNode store_obj(DataFlow::CallNode s) {
    result = store_obj(DataFlow::TypeTracker::end(), s)
  }

  /** The store object (hook or vanilla store). */
  DataFlow::SourceNode store_obj() { result = store_obj(_) }

  /**
   * A setter value of store `s`: the initializer's `set` parameter or a `setState` read off the
   * store object — type-tracked anywhere it flows (including through helper arguments:
   * `make_input(set, get)`).
   */
  private DataFlow::SourceNode setter(DataFlow::TypeTracker t, DataFlow::CallNode s) {
    t.start() and
    (
      result = initializer(s).getParameter(0)
      or
      result = store_obj(s).getAPropertyRead("setState")
    )
    or
    exists(DataFlow::TypeTracker t2 | result = setter(t2, s).track(t2, t))
  }

  /** A setter value of store `s` (see private overload). */
  DataFlow::SourceNode setter(DataFlow::CallNode s) {
    result = setter(DataFlow::TypeTracker::end(), s)
  }

  /** A setter value (any store). */
  DataFlow::SourceNode setter() { result = setter(_) }

  /** A call that writes store `s`: `set(...)` / `store.setState(...)`. */
  DataFlow::CallNode setter_call(DataFlow::CallNode s) { result = setter(s).getACall() }

  /** A call that writes a zustand store: `set(...)` / `store.setState(...)`. */
  DataFlow::CallNode setter_call() { result = setter_call(_) }

  /** A getter value of store `s`: the initializer's `get` parameter, tracked like `setter`. */
  private DataFlow::SourceNode getter(DataFlow::TypeTracker t, DataFlow::CallNode s) {
    t.start() and result = initializer(s).getParameter(1)
    or
    exists(DataFlow::TypeTracker t2 | result = getter(t2, s).track(t2, t))
  }

  /** A getter value (`get`) of store `s`. */
  DataFlow::SourceNode getter(DataFlow::CallNode s) {
    result = getter(DataFlow::TypeTracker::end(), s)
  }

  /**
   * A read of store `s`'s STATE: a `store.getState()` / initializer-`get()` call result, a hook
   * call result (`use_x()` whole state, `use_x(selector)` — the selection derives from state),
   * or a `subscribe` callback parameter (`(state, prev_state) => …`).
   */
  DataFlow::SourceNode state_read(DataFlow::CallNode s) {
    result = store_obj(s).getAMethodCall("getState")
    or
    result = getter(s).getACall()
    or
    result = store_obj(s).getACall()
    or
    result = store_obj(s).getAMethodCall("subscribe").getCallback(0).getAParameter()
  }

  /**
   * A dataflow position holding store `s`'s action `name`: the RHS of a property write on the
   * object the initializer returns.
   */
  private DataFlow::Node action_pos(DataFlow::CallNode s, string name) {
    exists(DataFlow::ObjectLiteralNode state, DataFlow::PropWrite pw |
      state.flowsTo(initializer(s).getFunction().getAReturnedExpr().flow()) and
      pw = state.getAPropertyWrite() and
      pw.getPropertyName() = name and
      result = pw.getRhs()
    )
  }

  /**
   * A "door" of store `s` — a function on the store's action surface, the ONE sanctioned writer
   * class (CODE_LAW L-P4). Covers actions declared inline in the returned object and actions
   * built by a maker call (`input: make_input(set, get)` — the maker's returned closure is the
   * door).
   */
  predicate door(DataFlow::FunctionNode f, DataFlow::CallNode s) {
    f = action_pos(s, _).getAFunctionValue()
    or
    exists(DataFlow::CallNode maker | maker.flowsTo(action_pos(s, _)) |
      f.flowsTo(maker.getACallee().getAReturnedExpr().flow())
    )
  }

  /** A "door" — a function on a store's action surface (any store). */
  predicate door(DataFlow::FunctionNode f) { door(f, _) }

  /**
   * A dispatch of store `s`'s action surface by name off a state read:
   * `use_x.getState().input(...)` / a hook-result action call. The call graph cannot resolve
   * these (the returned state object is opaque to it), so the door's NAME joined on the store's
   * own read surface is the model.
   */
  DataFlow::CallNode door_call(DataFlow::CallNode s) {
    exists(string name | exists(action_pos(s, name)) |
      result = state_read(s).getAPropertyRead(name).getACall()
    )
  }
}
