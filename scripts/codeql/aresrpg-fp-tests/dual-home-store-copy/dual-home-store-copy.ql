/**
 * @name Dual-home store copy — one store's state written into another store
 * @description Dataflow from one zustand store's state (a `getState()`/`get()` result, a hook
 *              selection, a `subscribe` callback's state, or an exported projection over them)
 *              into a DIFFERENT store's write surface (`set`/`setState` payload, an action-call
 *              argument) creates a SECOND HOME for one fact — every mirror consumer is a
 *              staleness bug (CODE_LAW L-P4, ONE reducer per domain; the 2026-07-17 fight-mirror
 *              class). A store deriving its OWN next state never matches. The flow is VALUE-level
 *              on purpose: verbatim copies flag — scalar snapshots included (the query cannot see
 *              "once" or "primitive"; a deliberately sanctioned snapshot rides the baseline
 *              ratchet, never an inline suppression) — while DERIVED facts (`view != null`) pass
 *              by construction because value flow stops at the operator: derive, don't copy.
 *
 *              STAGED HERE, next to its fixtures, NOT in aresrpg-fp/: gate.sh analyzes that
 *              directory, which runs EVERY .ql in it (defaultSuiteFile is ignored for directory
 *              arguments — measured), and the S2 mirror-kill lane is still deleting flagged
 *              copies. WIRING (the lead's post-kill step) = move this file into
 *              scripts/codeql/aresrpg-fp/, point the qlref back at `dual-home-store-copy.ql`,
 *              then `gate.sh --rebaseline`.
 * @kind problem
 * @problem.severity warning
 * @precision medium
 * @id js/aresrpg/dual-home-store-copy
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

/** A value of store `s`'s state: the read surface plus property reads off it, at any depth. */
DataFlow::SourceNode state_value(DataFlow::CallNode s) {
  result = Zustand::state_read(s)
  or
  result = state_value(s).getAPropertyRead()
}

/**
 * A payload position of write call `w`: its arguments, values stored into object/array literals
 * flowing into a payload position (the copy usually rides ONE property of the written patch),
 * and the return of an updater function (`set(prev => next)`).
 */
DataFlow::Node write_payload(DataFlow::CallNode w) {
  result = w.getAnArgument()
  or
  exists(DataFlow::ObjectLiteralNode obj | obj.flowsTo(write_payload(w)) |
    result = obj.getAPropertyWrite().getRhs()
    or
    result = obj.getASpreadProperty()
  )
  or
  exists(DataFlow::ArrayCreationNode arr | arr.flowsTo(write_payload(w)) |
    result = arr.getAnElement()
  )
  or
  exists(DataFlow::FunctionNode updater | updater.flowsTo(w.getAnArgument()) |
    result.asExpr() = updater.getFunction().getAReturnedExpr()
  )
}

/** `node` reads store `source`'s state. */
predicate reads_store(DataFlow::Node node, DataFlow::CallNode source) { node = state_value(source) }

/** `node` is a payload written into store `target` (its setter or its dispatched doors). */
predicate writes_store(DataFlow::Node node, DataFlow::CallNode target) {
  node = write_payload(Zustand::setter_call(target))
  or
  node = write_payload(Zustand::door_call(target))
}

module DualHomeConfig implements DataFlow::ConfigSig {
  predicate isSource(DataFlow::Node node) { reads_store(node, _) }

  predicate isSink(DataFlow::Node node) {
    writes_store(node, _) and not excluded_file(node.getFile())
  }
}

module Flow = DataFlow::Global<DualHomeConfig>;

from DataFlow::Node source, DataFlow::Node sink, DataFlow::CallNode a, DataFlow::CallNode b
where
  Flow::flow(source, sink) and
  reads_store(source, a) and
  writes_store(sink, b) and
  a != b
select sink,
  "This write copies $@ into a DIFFERENT store — a second home for one fact goes stale; derive at the read site, don't copy (CODE_LAW L-P4; the 2026-07-17 fight-mirror class).",
  source, "another store's state"
