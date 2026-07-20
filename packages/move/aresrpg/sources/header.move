module aresrpg::header;

// this module is useless
// it simply allows to start calls to aresrpg with "aresrpg"
//
// It is the on-chain MARKER that identifies an aresrpg transaction: clients prepend
// `<pkg>::header::aresrpg()` as command #0 so off-chain consumers (the sponsor service +
// the per-user pay-per-use fee counter) can filter "is this an aresrpg tx?" by the presence
// of this MoveCall. Deleted in the Kolizeum merge (80ead8a) which silently broke every
// frontend write that still prepended it (marketplace list/buy/sell, party actions);
// re-added as an upgrade-compatible new module. Keep it — it is load-bearing for sponsoring.

entry fun aresrpg() {}
