/// Header-marker test: `header::aresrpg()` is the load-bearing command #0 clients prepend so the sponsor service
/// + the fee counter can filter "is this an aresrpg tx?". It carries no logic — this only proves it is callable
/// (a compile+run guard against the module being accidentally deleted again, per its own post-mortem comment).
#[test_only]
module aresrpg::header_tests;

use aresrpg::header;

#[test]
fun aresrpg_marker_is_callable() {
  header::aresrpg(); // the on-chain marker — no state, no return; just must not abort
}
