// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import {
  createPublicClient,
  createWalletClient,
  custom,
  encodeFunctionData,
  erc20Abi,
  http,
  isAddress,
  type Chain,
} from 'viem'
import type { BaseConnectedEthereumWallet } from '@privy-io/react-auth'

import { EVM_CHAINS } from '../funding/chains.ts'

import type { FundingAsset, FundingBalance, FundingBalances, SourcePayment } from './external_session.ts'

const address = (value: string): `0x${string}` => {
  if (!isAddress(value)) throw new Error('funding_invalid_address')
  return value
}

const chain_balances = async (
  owner: `0x${string}`,
  chain: Readonly<Chain>,
  assets: readonly FundingAsset[],
  signal: Readonly<AbortSignal>,
  send = fetch
): Promise<readonly PromiseSettledResult<FundingBalance>[]> => {
  const client = createPublicClient({ chain, transport: http(undefined, { fetchFn: send, fetchOptions: { signal } }) })
  const tokens = assets.filter((asset) => asset.contract)
  const balances = tokens.length
    ? client.multicall({
        contracts: tokens.map((asset) => ({
          address: address(asset.contract!),
          abi: erc20Abi,
          functionName: 'balanceOf' as const,
          args: [owner] as const,
        })),
      })
    : Promise.resolve([])
  return Promise.allSettled([
    ...assets
      .filter((asset) => !asset.contract)
      .map(async (asset) => ({ ...asset, balance: await client.getBalance({ address: owner }) })),
    ...tokens.map(async (asset, index) => {
      const result = (await balances)[index]
      if (result.status === 'failure') throw result.error
      return { ...asset, balance: result.result }
    }),
  ])
}

/** Wallet switching belongs to payment confirmation, never to balance discovery. */
export const evm_balances = async (
  wallet: Readonly<BaseConnectedEthereumWallet>,
  assets: readonly FundingAsset[],
  signal: Readonly<AbortSignal>,
  send: typeof fetch = fetch
): Promise<FundingBalances> => {
  const chains = [...new Set(assets.map((asset) => asset.blockchain))].filter((name) => EVM_CHAINS[name])
  const batches = await Promise.allSettled(
    chains.map((name) =>
      chain_balances(
        address(wallet.address),
        EVM_CHAINS[name],
        assets.filter((asset) => asset.blockchain === name),
        signal,
        send
      )
    )
  )
  const results = batches.flatMap((result) => (result.status === 'fulfilled' ? result.value : [result]))
  return {
    assets: results.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : [])),
    failed: results.some((result) => result.status === 'rejected'),
  }
}

const client_for = async (wallet: Readonly<BaseConnectedEthereumWallet>, asset: FundingAsset) => {
  const chain = EVM_CHAINS[asset.blockchain]
  if (!chain) throw new Error('funding_route_unavailable')
  await wallet.switchChain(chain.id)
  const provider = await wallet.getEthereumProvider()
  const client = createPublicClient({ transport: custom(provider) })
  if ((await client.getChainId()) !== chain.id) throw new Error('funding_source_changed')
  const signer = createWalletClient({ transport: custom(provider), account: address(wallet.address) })
  if (!(await signer.getAddresses()).some((entry) => entry.toLowerCase() === wallet.address.toLowerCase()))
    throw new Error('funding_source_changed')
  return { client, signer, chain }
}

export const evm_balance = async (
  wallet: Readonly<BaseConnectedEthereumWallet>,
  asset: FundingAsset
): Promise<bigint> => {
  const { client } = await client_for(wallet, asset)
  return asset.contract
    ? client.readContract({
        address: address(asset.contract),
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [address(wallet.address)],
      })
    : client.getBalance({ address: address(wallet.address) })
}

export const evm_send = async (
  wallet: Readonly<BaseConnectedEthereumWallet>,
  payment: SourcePayment,
  submitting: () => void
): Promise<string> => {
  const { client, signer, chain } = await client_for(wallet, payment.asset)
  const account = address(wallet.address)
  const transaction = payment.asset.contract
    ? {
        to: address(payment.asset.contract),
        data: encodeFunctionData({
          abi: erc20Abi,
          functionName: 'transfer',
          args: [address(payment.recipient), payment.amount],
        }),
        value: 0n,
      }
    : { to: address(payment.recipient), value: payment.amount }
  const [gas, gas_price, balance] = await Promise.all([
    client.estimateGas({ account, ...transaction }),
    client.getGasPrice(),
    client.getBalance({ address: account }),
  ])
  if (balance < transaction.value + gas * gas_price) throw new Error('funding_source_gas')
  submitting()
  return signer.sendTransaction({ account, chain, ...transaction, gas })
}
