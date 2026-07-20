/**
 * @name Laundered store write — async result bypasses the reducer door
 * @description A zustand store write (`set`/`setState`) reachable from an async callback
 *              (timer / promise continuation / listener / await tail) at ANY call depth.
 *              Async results re-enter a domain as INPUTS through its reducer door — a store
 *              action such as `input(msg, now)` — nothing else writes (CODE_LAW L-P4, the
 *              ONE-PIPELINE law; the v1.12.28 crash class: setTimeout -> helper -> set()).
 *              Interprocedural big brother of eslint `one-pipeline/no-async-store-write`.
 * @kind problem
 * @problem.severity warning
 * @precision medium
 * @id js/aresrpg/laundered-store-write
 * @tags correctness
 *       aresrpg-fp
 *       L-P4
 */

import javascript
import zustand

/** Test/bench choreography is exempt (CODE_LAW §Operating). */
predicate excluded_file(File f) {
  exists(string p | p = f.getRelativePath() |
    p.matches("%.test.%") or
    p.matches("%.spec.%") or
    p.matches("test/%") or
    p.matches("%/test/%") or
    p.matches("e2e/%") or
    p.matches("%/e2e/%") or
    p.matches("bench/%") or
    p.matches("%/bench/%")
  )
}

/** An argument position whose function value runs on a detached (async) timeline. */
predicate async_cb_pos(DataFlow::Node arg, string ctx) {
  exists(string name |
    name =
      [
        "setTimeout", "setInterval", "setImmediate", "queueMicrotask", "requestAnimationFrame",
        "requestIdleCallback"
      ] and
    arg = DataFlow::globalVarRef(name).getACall().getArgument(0) and
    ctx = "a `" + name + "` callback"
  )
  or
  exists(DataFlow::MethodCallNode m |
    m.getMethodName() = ["then", "catch", "finally"] and
    arg = m.getArgument([0, 1]) and
    ctx = "a promise `." + m.getMethodName() + "()` continuation"
  )
  or
  exists(DataFlow::MethodCallNode m |
    m.getMethodName() = ["addEventListener", "addListener", "on", "once", "subscribe"] and
    arg = m.getAnArgument() and
    ctx = "a `." + m.getMethodName() + "()` listener"
  )
}

/** Sync array combinators run their callback on the caller's own timeline — transparent for the walk. */
private string sync_combinator() {
  result =
    [
      "forEach", "map", "filter", "reduce", "reduceRight", "some", "every", "find", "findIndex",
      "findLast", "flatMap", "sort"
    ]
}

/**
 * An await boundary inside function `f`: code positioned at or after (line, col) in `f` runs as a
 * later microtask. An `AwaitExpr` ends one; a `for await` body starts inside one from its first
 * iteration (the iterator step is awaited before the body runs).
 */
private predicate await_boundary(Function f, int line, int col, Locatable origin) {
  exists(AwaitExpr a | a.getContainer() = f and origin = a |
    a.getLocation().hasLocationInfo(_, _, _, line, col)
  )
  or
  exists(ForOfStmt fo | fo.isAwait() and fo.getContainer() = f and origin = fo |
    fo.getBody().getLocation().hasLocationInfo(_, line, col, _, _)
  )
}

/** Expression `e` executes after an await boundary within its own (async) function. */
predicate await_tail(Expr e, Locatable origin) {
  exists(Function f, int bl, int bc, int el, int ec |
    f = e.getContainer() and
    f.isAsync() and
    await_boundary(f, bl, bc, origin) and
    e.getLocation().hasLocationInfo(_, el, ec, _, _) and
    (bl < el or bl = el and bc <= ec)
  )
}

/**
 * Functions running on a detached timeline (the async origin threaded through for reporting).
 * A door (a store action — the sanctioned re-entry) never becomes tainted: dispatching the door
 * from an async continuation IS the law's happy path.
 */
predicate tainted_fn(DataFlow::FunctionNode f, Locatable origin, string ctx) {
  not Zustand::door(f) and
  (
    exists(DataFlow::Node arg | async_cb_pos(arg, ctx) and origin = arg.asExpr() |
      f = arg.getAFunctionValue()
    )
    or
    exists(DataFlow::InvokeNode call | tainted_call(call, origin, ctx) |
      f.getFunction() = call.getACallee()
      or
      call.(DataFlow::MethodCallNode).getMethodName() = sync_combinator() and
      f = call.getCallback(_)
    )
  )
}

/** Calls executing on a detached timeline: inside a tainted function, or after an await boundary. */
predicate tainted_call(DataFlow::InvokeNode call, Locatable origin, string ctx) {
  exists(DataFlow::FunctionNode f | tainted_fn(f, origin, ctx) |
    call.asExpr().getContainer() = f.getFunction()
  )
  or
  await_tail(call.asExpr(), origin) and
  ctx = "an `await` continuation (code after `await` resumes as a later microtask)"
}

from DataFlow::CallNode write, Locatable origin, string ctx
where
  write = Zustand::setter_call() and
  not excluded_file(write.getFile()) and
  tainted_call(write, origin, ctx)
select write,
  "Store write reaches here from $@ — async results re-enter through the reducer door (a store action / `input(msg, now)`), never a direct `set`/`setState` (CODE_LAW L-P4; the v1.12.28 crash class).",
  origin, ctx
