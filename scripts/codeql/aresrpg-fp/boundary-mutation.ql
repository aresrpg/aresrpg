/**
 * @name Boundary mutation — writing through another module's value
 * @description A parameter that crossed a module boundary (an exported function, or one invoked
 *              from another file) is the CALLER'S value: mutating it — property/element writes,
 *              mutating methods, `Object.assign`, `delete` — including through aliases and
 *              nested callees, leaks hidden change back to the caller (CODE_LAW L-I2).
 *              Interprocedural deep form of `no-param-reassign`: value flow means a fresh copy
 *              (`{ ...p }`, `[...xs]`) never matches (L-I3 construction stays legal). The
 *              engine package and test choreography are exempt per CODE_LAW tiers; `.current`
 *              chains (React ref contract) are excluded.
 * @kind problem
 * @problem.severity warning
 * @precision medium
 * @id js/aresrpg/boundary-mutation
 * @tags correctness
 *       aresrpg-fp
 *       L-I2
 */

import javascript

/** CODE_LAW mutation-family scope: packages + api, minus the engine tier and test choreography. */
predicate law_scope(File f) {
  exists(string p | p = f.getRelativePath() |
    (p.matches("packages/%") or p.matches("api/%")) and
    not p.matches("packages/engine/%") and
    not p.matches("%.test.%") and
    not p.matches("%.spec.%") and
    not p.matches("%/e2e/%") and
    not p.matches("%/bench/%") and
    not p.matches("%/test/%")
  )
}

/** A function whose parameters receive values from other modules: exported, or called cross-file. */
predicate boundary_function(DataFlow::FunctionNode f) {
  law_scope(f.getFunction().getFile()) and
  (
    exists(Module m | f.flowsTo(m.getAnExportedValue(_)))
    or
    exists(DataFlow::InvokeNode inv |
      inv.getACallee() = f.getFunction() and
      inv.getFile() != f.getFunction().getFile()
    )
  )
}

/** The innermost non-property-access base of a member chain: `p` for `p.data.x`. */
private Expr chain_root(Expr e) {
  not e instanceof PropAccess and result = e
  or
  result = chain_root(e.(PropAccess).getBase())
}

/** Any property access within `e` named `current` — the React ref contract. */
private predicate mentions_current(Expr e) {
  exists(PropAccess pa | pa.getParentExpr*() = e | pa.getPropertyName() = "current")
}

/** `sink` is the root of a value being mutated, with `kind` describing the mutation. */
predicate mutation(DataFlow::Node sink, string kind) {
  exists(DataFlow::PropWrite pw, Expr base | base = pw.getBase().asExpr() |
    sink.asExpr() = chain_root(base) and
    not pw.getPropertyName() = "current" and
    not mentions_current(base) and
    kind = "a property write"
  )
  or
  exists(DataFlow::MethodCallNode mc, Expr recv |
    mc.getMethodName() =
      [
        "push", "pop", "shift", "unshift", "splice", "sort", "reverse", "fill", "copyWithin",
        "set", "add", "delete", "clear"
      ] and
    recv = mc.getReceiver().asExpr()
  |
    sink.asExpr() = chain_root(recv) and
    not mentions_current(recv) and
    kind = "a mutating `." + mc.getMethodName() + "()` call"
  )
  or
  exists(DataFlow::CallNode assign | assign = DataFlow::globalVarRef("Object").getAMemberCall("assign") |
    sink = assign.getArgument(0) and kind = "an `Object.assign` target"
  )
  or
  exists(DeleteExpr del, PropAccess target | target = del.getOperand().stripParens() |
    sink.asExpr() = chain_root(target.getBase()) and
    not mentions_current(target) and
    kind = "a `delete`"
  )
}

module BoundaryMutationConfig implements DataFlow::ConfigSig {
  predicate isSource(DataFlow::Node node) {
    exists(DataFlow::FunctionNode f | boundary_function(f) | node = f.getAParameter())
  }

  predicate isSink(DataFlow::Node node) { mutation(node, _) and law_scope(node.getFile()) }
}

module Flow = DataFlow::Global<BoundaryMutationConfig>;

from DataFlow::Node source, DataFlow::Node sink, string kind
where Flow::flow(source, sink) and mutation(sink, kind)
select sink,
  "This value is the target of " + kind +
    " but it flowed in as $@ from another module — parameters are the caller's: return new values (CODE_LAW L-I2).",
  source, "this boundary parameter"
