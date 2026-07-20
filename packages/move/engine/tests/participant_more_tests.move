/// Pure unit coverage for `participant`'s zero-covered getters/mutators over a bare `Participant` — no Fight or
/// Scenario needed (`participant::new` + the HP/AP/MP/stat mutators are `public(package)`, directly callable from
/// any module in this package).
#[test_only]
module aresrpg_fight::participant_more_tests;

use aresrpg_fight::participant;
use aresrpg_fight::fight_scaffold::combatant;

const OWNER: address = @0xA;
const CHAR: address = @0xC0;

#[test]
fun bare_participant_getters_and_mutators() {
  let mut p = participant::new(combatant(CHAR, 100), OWNER, 0, 5);
  assert!(participant::class(&p) == b"senshi".to_string());
  assert!(participant::level(&p) == 1);
  assert!(participant::base_ap(&p) == 6);
  assert!(participant::mp(&p) == 0); // AP/MP start at 0 until begin_turn refills

  participant::give_points(&mut p, 0, 4); // AP
  participant::give_points(&mut p, 1, 2); // MP
  assert!(participant::mp(&p) == 2);

  participant::remove_points(&mut p, 0, 1);
  participant::remove_points(&mut p, 1, 1);
  assert!(participant::mp(&p) == 1);

  participant::spend_mp(&mut p, 1);
  assert!(participant::mp(&p) == 0);

  participant::apply_damage(&mut p, 30);
  participant::apply_heal(&mut p, 15);
  assert!(participant::hp(&p) == 85);

  participant::alter_base_resist(&mut p, 0, 5, false); // fire resist +5, permanent
  participant::alter_base_resist(&mut p, 0, 2, true); // fire resist -2, permanent

  assert!(participant::spell_level_of(&p, object::id_from_address(@0xF00)) == 1); // absent -> default 1
}
