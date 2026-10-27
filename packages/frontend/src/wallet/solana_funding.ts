// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import {
  address,
  appendTransactionMessageInstructions,
  compileTransaction,
  createNoopSigner,
  createSolanaRpc,
  createTransactionMessage,
  getBase58Decoder,
  getBase64Decoder,
  getTransactionEncoder,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  type Address,
  type TransactionMessageBytesBase64,
  type Instruction,
} from '@solana/kit'
import { getTransferSolInstruction } from '@solana-program/system'
import {
  findAssociatedTokenPda,
  getCreateAssociatedTokenIdempotentInstruction,
  getTokenSize,
  getTransferCheckedInstruction,
  TOKEN_PROGRAM_ADDRESS,
} from '@solana-program/token'
import type { BaseConnectedSolanaWallet } from '@privy-io/react-auth'

import { SOLANA_RPC_PATH } from '../funding/solana_rpc_contract.ts'

import type { FundingAsset, FundingBalances, SourcePayment } from './external_session.ts'

type FundingRpc = ReturnType<typeof createSolanaRpc>
const connection = (): FundingRpc => createSolanaRpc(new URL(SOLANA_RPC_PATH, window.location.origin).href)

const token_accounts = async (
  rpc: Readonly<FundingRpc>,
  owner: Address,
  mint?: Address,
  signal?: Readonly<AbortSignal>
) => {
  const { value } = await rpc
    .getTokenAccountsByOwner(owner, mint ? { mint } : { programId: TOKEN_PROGRAM_ADDRESS }, {
      encoding: 'jsonParsed',
      commitment: 'confirmed',
    })
    .send({ abortSignal: signal })
  return value
    .filter(({ account }) => account.owner === TOKEN_PROGRAM_ADDRESS)
    .map(({ pubkey, account }) => ({
      address: pubkey,
      mint: String(account.data.parsed.info.mint),
      amount: BigInt(account.data.parsed.info.tokenAmount.amount as string),
      decimals: Number(account.data.parsed.info.tokenAmount.decimals),
    }))
}

export const solana_balances = async (
  wallet: Readonly<BaseConnectedSolanaWallet>,
  assets: readonly FundingAsset[],
  signal: Readonly<AbortSignal>,
  rpc: Readonly<FundingRpc> = connection()
): Promise<FundingBalances> => {
  const owner = address(wallet.address)
  const [native, tokens] = await Promise.all([
    rpc.getBalance(owner, { commitment: 'confirmed' }).send({ abortSignal: signal }),
    token_accounts(rpc, owner, undefined, signal),
  ])
  return {
    assets: assets
      .filter((asset) => asset.blockchain === 'sol')
      .map((asset) => ({
        ...asset,
        balance: asset.contract
          ? tokens
              .filter((account) => account.mint === asset.contract)
              .reduce((sum, account) => sum + account.amount, 0n)
          : native.value,
      })),
    failed: false,
  }
}

export const solana_balance = async (
  wallet: Readonly<BaseConnectedSolanaWallet>,
  asset: FundingAsset
): Promise<bigint> => {
  const rpc = connection()
  const owner = address(wallet.address)
  if (!asset.contract) return (await rpc.getBalance(owner, { commitment: 'confirmed' }).send()).value
  const accounts = await token_accounts(rpc, owner, address(asset.contract))
  return accounts.reduce((sum, account) => sum + account.amount, 0n)
}

const token_transfer = async (rpc: Readonly<FundingRpc>, owner: Address, payment: SourcePayment) => {
  const mint = address(payment.asset.contract!)
  const [destination] = await findAssociatedTokenPda({
    mint,
    owner: address(payment.recipient),
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
  })
  const signer = createNoopSigner(owner)
  const accounts = await token_accounts(rpc, owner, mint)
  const plan = accounts.reduce<Readonly<{ remaining: bigint; instructions: readonly Instruction[] }>>(
    (result, account) => {
      const amount = account.amount < result.remaining ? account.amount : result.remaining
      if (!amount) return result
      if (account.decimals !== payment.asset.decimals) throw new Error('funding_invalid_response')
      return {
        remaining: result.remaining - amount,
        instructions: [
          ...result.instructions,
          getTransferCheckedInstruction({
            source: account.address,
            mint,
            destination,
            authority: signer,
            amount,
            decimals: account.decimals,
          }),
        ],
      }
    },
    {
      remaining: payment.amount,
      instructions: [
        getCreateAssociatedTokenIdempotentInstruction({
          payer: signer,
          ata: destination,
          owner: address(payment.recipient),
          mint,
        }),
      ],
    }
  )
  if (plan.remaining) throw new Error('funding_source_balance')
  const { value: destination_account } = await rpc
    .getAccountInfo(destination, { encoding: 'base64', commitment: 'confirmed' })
    .send()
  const rent = destination_account
    ? 0n
    : await rpc.getMinimumBalanceForRentExemption(BigInt(getTokenSize()), { commitment: 'confirmed' }).send()
  return { instructions: plan.instructions, rent }
}

export const solana_send = async (
  wallet: Readonly<BaseConnectedSolanaWallet>,
  payment: SourcePayment,
  submitting: () => void,
  rpc: Readonly<FundingRpc> = connection()
): Promise<string> => {
  const owner = address(wallet.address)
  if (!(await wallet.isConnected())) throw new Error('funding_source_changed')
  const transfer = payment.asset.contract
    ? await token_transfer(rpc, owner, payment)
    : {
        instructions: [
          getTransferSolInstruction({
            source: createNoopSigner(owner),
            destination: address(payment.recipient),
            amount: payment.amount,
          }),
        ],
        rent: 0n,
      }
  const { value: lifetime } = await rpc.getLatestBlockhash({ commitment: 'confirmed' }).send()
  const transaction = compileTransaction(
    pipe(
      createTransactionMessage({ version: 0 }),
      (message) => setTransactionMessageFeePayer(owner, message),
      (message) => setTransactionMessageLifetimeUsingBlockhash(lifetime, message),
      (message) => appendTransactionMessageInstructions(transfer.instructions, message)
    )
  )
  const message = getBase64Decoder().decode(transaction.messageBytes) as TransactionMessageBytesBase64
  const [fee, balance] = await Promise.all([
    rpc.getFeeForMessage(message, { commitment: 'confirmed' }).send(),
    rpc.getBalance(owner, { commitment: 'confirmed' }).send(),
  ])
  if (fee.value === null) throw new Error('funding_route_unavailable')
  const spending = payment.asset.contract ? 0n : payment.amount
  if (balance.value < spending + fee.value + transfer.rent) throw new Error('funding_source_gas')
  const bytes = new Uint8Array(getTransactionEncoder().encode(transaction))
  submitting()
  const { signature } = await wallet.provider.signAndSendTransaction({ transaction: bytes, chain: 'solana:mainnet' })
  return getBase58Decoder().decode(signature)
}
