/// SPELL BOOK TESTS — coverage for `is_learned`/`max_level`, not exercised by the source-file inline tests
/// (which check `current_level(...) >= 1` directly rather than through the `is_learned` convenience wrapper).
#[test_only]
module aresrpg_foundation::spell_book_tests;

use aresrpg_foundation::spell_book as book;

#[test]
fun t_is_learned_and_max_level() {
  let mut alloc = book::new_allocation();
  assert!(!book::is_learned(&alloc, 1), 0);
  book::learn(&mut alloc, 1);
  assert!(book::is_learned(&alloc, 1), 1);
  assert!(!book::is_learned(&alloc, 2), 2); // a different spell id stays unlearned
  assert!(book::max_level() == 6, 3);
}
