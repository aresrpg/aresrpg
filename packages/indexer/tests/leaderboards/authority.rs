use std::collections::BTreeMap;
use std::path::PathBuf;

fn compact(source: &str) -> String {
    source
        .chars()
        .filter(|character| !character.is_whitespace())
        .collect()
}

fn body<'a>(source: &'a str, name: &str) -> &'a str {
    let start = source
        .find(&format!("fun {name}("))
        .expect("authority function exists");
    let start = start + source[start..].find('{').unwrap() + 1;
    let mut depth = 1;
    for (offset, character) in source[start..].char_indices() {
        match character {
            '{' => depth += 1,
            '}' => depth -= 1,
            _ => (),
        }
        if depth == 0 {
            return &source[start..start + offset];
        }
    }
    panic!("authority function has no closing brace");
}

#[test]
fn positive_character_xp_is_only_a_sender_authorized_victory_award() {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../move/sources");
    let sources: BTreeMap<_, _> = std::fs::read_dir(&root)
        .unwrap()
        .map(|entry| entry.unwrap().path())
        .filter(|path| {
            path.extension()
                .is_some_and(|extension| extension == "move")
        })
        .map(|path| {
            (
                path.file_stem().unwrap().to_string_lossy().to_string(),
                std::fs::read_to_string(path).unwrap(),
            )
        })
        .collect();
    let declarations_and_calls: BTreeMap<_, _> = sources
        .iter()
        .filter_map(|(module, source)| {
            let count = compact(source).matches("add_experience(").count();
            (count > 0).then_some((module.as_str(), count))
        })
        .collect();
    assert_eq!(
        declarations_and_calls,
        BTreeMap::from([("character", 1), ("fight", 1)]),
        "a new XP source requires updating leaderboard attribution"
    );
    let character = &sources["character"];
    let fight = &sources["fight"];
    assert!(
        compact(body(character, "create_character")).contains("experience:0,"),
        "birth must not grant leaderboard XP"
    );
    assert!(compact(body(fight, "settle_seat"))
        .contains("if(won)character::add_experience(&mutcharacter,experience);"));
    assert_eq!(
        compact(fight).matches("settle_seat(").count(),
        3,
        "only the two owner-checked settlement doors may award XP"
    );
    for door in ["settle", "settle_pvp"] {
        assert!(
            compact(body(fight, door)).starts_with("let_=assert_fighter_owner(fight,fighter,ctx);"),
            "{door} must authorize the sender before doing any settlement work"
        );
    }
    // This deliberately pins the small authority boundary, not combat implementation.
    // Delegated or permissionless settlement would change which address earns the delta.
    assert_eq!(
        compact(body(fight, "assert_fighter_owner")),
        compact(
            r#"
        assert!(fighter < fight.authorities.length(), ENotYourFighter);
        match (&fight.authorities[fighter]) {
          FighterAuthority::Player { character, owner, .. } => {
            assert!(*owner == ctx.sender() && !combat::fighter_settled(&fight.combat, fighter), ENotYourFighter);
            *character
          },
          FighterAuthority::Mob => abort ENotYourFighter,
        }
    "#
        )
    );
}
