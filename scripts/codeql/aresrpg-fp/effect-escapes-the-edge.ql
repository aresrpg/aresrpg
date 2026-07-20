/**
 * @name Effect escapes the edge — impurity inside the fight reducer core
 * @description The fight core (packages/fight/src/) is ONE pure reducer with effects at
 *              the edges (CODE_LAW L-P4/L-P1; fight/index.js: "one reducer, one input door, one
 *              presentation queue, one projection surface"). The ONE sanctioned effect seam is
 *              fight/txs.js ("the transaction seam ... No fight state is written here"). This
 *              query flags effect calls — timers, network, storage, listener registration,
 *              nondeterminism (Date.now / Math.random / new Date()) — lexically in the core or
 *              transitively reachable from it at any call depth, EXCEPT the seam and the
 *              `now = Date.now()` parameter-default convention (the input edge, store.js
 *              `input(msg, now = Date.now())`).
 * @kind problem
 * @problem.severity error
 * @precision high
 * @id js/aresrpg/effect-escapes-the-edge
 * @tags correctness
 *       aresrpg-fp
 *       L-P4
 *       L-P1
 */

import javascript

/** The sanctioned effect seam: fight/txs.js. */
predicate seam_file(File f) { f.getRelativePath().matches("%packages/fight/src/txs.js") }

/** The fight core: everything under fight/ except the seam and test choreography. */
predicate core_file(File f) {
  f.getRelativePath().matches("%packages/fight/src/%") and
  not f.getRelativePath().matches("%.test.%") and
  not seam_file(f)
}

/** Sync array combinators run their callback on the caller's own timeline. */
private string sync_combinator() {
  result =
    [
      "forEach", "map", "filter", "reduce", "reduceRight", "some", "every", "find", "findIndex",
      "findLast", "flatMap", "sort"
    ]
}

/**
 * Containers whose code belongs to the fold: every function and module top-level of a core file
 * (the whole dir is the hermetic reducer core by law), plus anything the fold transitively calls
 * — helpers outside fight/ included (turn_commit.js, @aresrpg/sim) — stopping at the seam.
 */
predicate fold_container(StmtContainer c) {
  core_file(c.getFile())
  or
  not seam_file(c.getFile()) and
  exists(DataFlow::InvokeNode call | fold_call(call) |
    c = call.getACallee()
    or
    call.(DataFlow::MethodCallNode).getMethodName() = sync_combinator() and
    c = call.getCallback(_).getFunction()
  )
}

/** A call issued from fold territory. */
predicate fold_call(DataFlow::InvokeNode call) { fold_container(call.getContainer()) }

/** An effect call: I/O, timers, listener registration, or nondeterminism. */
predicate effect_call(DataFlow::Node call, string kind) {
  exists(string name |
    name =
      [
        "setTimeout", "setInterval", "setImmediate", "queueMicrotask", "requestAnimationFrame",
        "requestIdleCallback"
      ]
  |
    call = DataFlow::globalVarRef(name).getACall() and kind = "a `" + name + "` timer"
  )
  or
  call = DataFlow::globalVarRef("fetch").getACall() and kind = "a network request (`fetch`)"
  or
  exists(string cls | cls = ["WebSocket", "XMLHttpRequest", "EventSource"] |
    call = DataFlow::globalVarRef(cls).getAnInstantiation() and kind = "a network channel (`new " + cls + "`)"
  )
  or
  call = DataFlow::globalVarRef("navigator").getAMemberCall("sendBeacon") and kind = "a network beacon"
  or
  exists(string store | store = ["localStorage", "sessionStorage", "indexedDB", "caches"] |
    call = DataFlow::globalVarRef(store).getAMemberCall(_) and kind = "storage access (`" + store + "`)"
  )
  or
  call = DataFlow::globalVarRef("Date").getAMemberCall("now") and kind = "nondeterminism (`Date.now()`)"
  or
  exists(DataFlow::NewNode n | n = DataFlow::globalVarRef("Date").getAnInstantiation() |
    call = n and not exists(n.getAnArgument()) and kind = "nondeterminism (`new Date()`)"
  )
  or
  call = DataFlow::globalVarRef("Math").getAMemberCall("random") and kind = "nondeterminism (`Math.random()`)"
  or
  call = DataFlow::globalVarRef("performance").getAMemberCall("now") and kind = "nondeterminism (`performance.now()`)"
  or
  call = DataFlow::globalVarRef("crypto").getAMemberCall(["getRandomValues", "randomUUID"]) and
  kind = "nondeterminism (`crypto`)"
  or
  exists(DataFlow::MethodCallNode m |
    m.getMethodName() = ["addEventListener", "addListener", "on", "once", "subscribe"] and
    call = m and
    kind = "listener registration (`." + m.getMethodName() + "()`)"
  )
}

/**
 * The sanctioned edge convention: `(msg, now = Date.now())` — time enters as an INPUT whose
 * default is sampled at the door signature, never inside the fold body (store.js:287).
 */
predicate param_default_pos(DataFlow::Node call) {
  exists(Parameter p | call.asExpr().getParentExpr*() = p.getDefault())
}

from DataFlow::Node call, string kind
where
  effect_call(call, kind) and
  fold_container(call.getContainer()) and
  not param_default_pos(call)
select call,
  "The reducer fold reaches " + kind +
    " — the fight core is pure over (msg, now); effects live at the seam (fight/txs.js) or enter as inputs (CODE_LAW L-P4/L-P1)."
