// Real public wire bytes from testnet checkpoint390188580, captured2026-10-02.
// Sui1.74 rejected the allowance withdrawal at enum variant2 before projection could run.
use sui_indexer_alt_framework::types::transaction::{
    CallArg, TransactionData, TransactionKind, WithdrawFrom,
};

#[test]
fn captured_allowance_withdrawal_remains_decodable_by_the_ingestion_types() {
    let fixture: serde_json::Value =
        serde_json::from_str(include_str!("checkpoint_wire.testnet.json")).unwrap();
    let bytes = hex::decode(fixture["bcs"].as_str().unwrap()).unwrap();
    let transaction: TransactionData = bcs::from_bytes(&bytes).unwrap();
    assert_eq!(
        transaction.digest().to_string(),
        fixture["digest"].as_str().unwrap()
    );
    let TransactionData::V1(transaction) = transaction;
    let TransactionKind::ProgrammableTransaction(ptb) = transaction.kind else {
        panic!("expected PTB")
    };
    assert!(ptb.inputs.iter().any(|input| matches!(input,
        CallArg::FundsWithdrawal(withdrawal) if matches!(withdrawal.withdraw_from, WithdrawFrom::SenderAllowance { .. })
    )));
}
