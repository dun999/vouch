# Attestcoin integration notes

Constants and behaviours **verified live against CC3 testnet**, not taken from docs.
Re-check with the commands below if anything stops working.

## Constants

| Thing | Value |
|---|---|
| Creditcoin CC3 testnet chainId | `102031` |
| Creditcoin RPC | `https://rpc.cc3-testnet.creditcoin.network` |
| Block prover precompile | `0x0000000000000000000000000000000000000FD2` |
| Chain info precompile | `0x0000000000000000000000000000000000000FD3` |
| Prover service | `https://prover.cc3-testnet.creditcoin.network` |
| Proof endpoint | `GET /api/v1/proof-by-tx/{chainKey}/{txHash}` |
| **Sepolia chainKey** | **`1`** (payments / `VouchCore`) |
| **Ethereum mainnet chainKey** | **`3`** (Uniswap V2 `Sync` / `PriceOracle`) |
| Uniswap V2 price pair | WCTC (old) / USDT `0x4a4F4fcA1a9B673f9eB23b7EeFe9dFbafd8D8140` |
| Solidity source | `@gluwa/usc-contracts@0.2.0`, vendored into `contracts/src/vendor/` |
| TS SDK | `@gluwa/usc-sdk@0.18.0` (ethers v6 peer dep) |

`get_supported_chains()` on `0x0FD3` returns `[(3, 1, "Ethereum"), (1, 11155111, "Sepolia ethereum")]`
— note chainKey 1 is **Sepolia**, while the SDK's own doc comments show chainKey 1 as Ethereum
mainnet. Resolve it at runtime rather than trusting the docs.

Both precompiles return empty `eth_getCode`. That is normal for natives and does not mean they are
absent; `NativeQueryVerifierLib.hasPrecompile()` special-cases it via chainId.

## Two behaviours that drive the contract design

1. **The prover proves inclusion, not success.** A reverted Sepolia transaction still verifies.
   `VouchCore` independently requires `decodeReceiptFields(encodedTx).receiptStatus == 1`.
2. **Decoded fields carry no transaction hash.** `CommonTxFields` is
   `{nonce, gasLimit, from, toIsNull, to, value, data}`. Replay protection therefore keys on
   `(chainKey, height, txIndex)` with `txIndex` from the precompile's own `calculateTxIndex`,
   never on a caller-supplied hash (which would be forgeable).

## Attestation lag

Measured 2026-09-08: latest attested Sepolia height trailed the chain head by **43 blocks (~9
minutes)**. A payment is not provable until its block is attested. Treat the claim flow as
asynchronous and show real progress in the UI.

## Reproducing the checks

```bash
# chainId -> 0x18e8f (102031)
cast chain-id --rpc-url https://rpc.cc3-testnet.creditcoin.network

# supported chains (which chainKey is Sepolia?)
cast call 0x0000000000000000000000000000000000000FD3 \
  "get_supported_chains()((uint64,uint64,string,uint8)[])" \
  --rpc-url https://rpc.cc3-testnet.creditcoin.network

# how far behind is attestation? (1 = Sepolia payments, 3 = Ethereum prices)
cast call 0x0000000000000000000000000000000000000FD3 \
  "get_latest_attestation_height_and_hash(uint64)(uint64,bytes32,bool)" 1 \
  --rpc-url https://rpc.cc3-testnet.creditcoin.network
cast call 0x0000000000000000000000000000000000000FD3 \
  "get_latest_attestation_height_and_hash(uint64)(uint64,bytes32,bool)" 3 \
  --rpc-url https://rpc.cc3-testnet.creditcoin.network

# fetch a real proof (Sepolia payment or Ethereum Sync)
curl "https://prover.cc3-testnet.creditcoin.network/api/v1/proof-by-tx/1/<txHash>"
curl "https://prover.cc3-testnet.creditcoin.network/api/v1/proof-by-tx/3/<txHash>"
```

`contracts/test/fixtures/sepolia-transfer.json` is a real proof for a real Sepolia ETH transfer
(block 11658200, txIndex 4, 2.5 ETH). Its `verify()` returns `true` on the live precompile, and the
test suite decodes it with the real `EvmV1Decoder`.

## Price observations (Ethereum mainnet Sync)

`VouchCore` still verifies Sepolia MockUSDC transfers on chain key `1`. `PriceOracle` is a
separate Attestcoin consumer: it is constructed with chain key `3` and reads a Uniswap V2
`Sync(uint112,uint112)` from Ethereum mainnet. There is no CTC/USDC V2 pair on mainnet or
Sepolia; the configured pair is WCTC (old) / USDT, where WCTC is token0 (18 decimals) and USDT
is token1 (6 decimals). Uniswap V3 pools cannot be used because they do not emit `Sync`.

App cashback (`AppCashback`) quotes a percentage of verified spend using `PriceOracle.readRate()`.
Merchant quest and campaign cashback does not use the oracle.

A live mainnet Sync was pushed on 2026-09-09:

| Step | Evidence |
|---|---|
| Source swap (Ethereum) | `0xfdcae0146c9106fe200fd2825671ee5e152a0bf69be5c1df6a1a4a97560a9523`, block 25938627, txIndex 261 |
| Pair | `0x4a4F4fcA1a9B673f9eB23b7EeFe9dFbafd8D8140` |
| `0x0FD2.verify(chainKey=3, …)` | `true` |
| `pushSyncProof` (Creditcoin) | `0x87f64fafc226a4e25d63e63577efd42a85a40a72a3986fd2f12d80c7cf751705`, status 1, gasUsed 371,930 |
| Result | `ctcPerUsd` ≈ 12.998 CTC / $1, `isManual = false`, `observedAtHeight = 25938627` |

Refresh with `PRICE_ORACLE=0x… PRIVATE_KEY=0x… pnpm sync:price`. The oracle's `maxAge` on this
deployment is 7 days.

## Current deployment (CC3 testnet, chainId 102031)

| Contract | Address |
|---|---|
| CommerceRegistry | `0x4491522938510A999ad28D145BE3782939D6cd43` |
| BenefitPass | `0xE1f8754bF3E384f2e42c3c7de8bDc73956451434` |
| VouchCore | `0xa208b46d4016D799799591A41500E3f3b44549A0` |
| QuestManager | `0x19B1aA6eAb81cBC6d742A966633a9F867b31F7D1` |
| RewardVault | `0xD94278AF61cB016CEc7Be98a25E7b0ecf01D61ac` |
| MilestoneManager | `0xD295ADCce48f68B6b2369521a2eFc6f4260305a4` |
| Catalog | `0x1eb050Db90c64Ca67C2F424414b7C193E7040Bb9` |
| PriceOracle | `0xE705Ee700Cd619e98751ca1D072B87931Ce5e81D` |
| AppCashback | `0x9E7063023e65CD1c593C7d0397C3F7692Af92700` |
| PaymentToken (Sepolia MockUSDC) | `0xBcb107E49F78C9dBa122eA31137B6ED903F65AeC` |

`VouchCore.CHAIN_KEY` is `1` (Sepolia). `PriceOracle.CHAIN_KEY` is `3` (Ethereum). Both bind
`VERIFIER` to the real `0x0FD2` precompile. App cashback treasury is 2020 CTC after a 2000 CTC
top-up on top of the original 20 CTC seed.

## Earlier ETH-payment experiment (CC3 testnet)

These addresses belong to the first ETH-transfer iteration, not the current MockUSDC deployment.

| Contract | Address |
|---|---|
| CommerceRegistry | `0xbB54d51f8bDA5B9bBb0364e8e555a5623850f66d` |
| BenefitPass | `0xBcb107E49F78C9dBa122eA31137B6ED903F65AeC` |
| VouchCore | `0x5F356e04bB11651eD083Ca9b6abF19fe4bE26855` |
| QuestManager | `0x361E1e7E26267207185d96e617Aae44d7F93d517` |
| RewardVault | `0x3a1081e9B494Af63d254cf64f90189ea85481f9E` |

## Two Foundry gotchas on this chain

Both cost real transactions to discover. Neither is a contract bug.

**1. `evm_version` must not be `cancun` (or `shanghai`).** CC3 testnet block headers carry no
`mixHash`, `withdrawalsRoot` or `excessBlobGas`. Foundry's simulation fails outright with
``header validation error: `prevrandao` not set``, and a cancun target could also emit `mcopy` /
`tstore` opcodes the chain may not implement. `foundry.toml` pins `evm_version = "london"`.

Even with london, `forge script` still logs
``failed to fetch block … missing field `mixHash` `` while polling receipts. That noise is
harmless — the transactions do land. Verify results by querying the chain, not by trusting the
script's summary, whose per-transaction labels get scrambled when receipt polling fails.

**2. Gas estimates come back low; an under-estimate burns the whole limit.** Three wiring calls
failed with `gasUsed == gasLimit` on the first deploy. Use
`forge script … --gas-estimate-multiplier 300`, or an explicit `--gas-limit` on `cast send`.
`scripts/claim.mjs` doubles its own estimate for the same reason.

## Proven end to end on live infrastructure

A real Sepolia payment carried the whole loop, 2026-09-08:

| Step | Evidence |
|---|---|
| Payment (Sepolia) | `0x594450946eb2cd34d55d5255fba80c2aac59e5f6a658f4e4626a3c2f2a635cae`, block 11658823, 0.002 ETH |
| Attestation wait | 440s (~7.3 min) from payment to servable proof |
| Proof | height 11658823, txIndex 74 |
| Claim (Creditcoin) | `0x89b303d7cb103874211f671847c9bd6f0d3930e495a72abf6ade684387b5f595`, status 1, gasUsed 574,013 |
| Result | Receipt #1, 450 XP, Benefit Pass #1 minted, quest 1 progress 1/2 |
| Replay | A second submission of the same proof is rejected on-chain with `PurchaseAlreadyClaimed(0x720b3ff2…)` |

XP checks out exactly: 50 flat + 0.002 ETH x 200,000 XP/ETH = 450.

`recordPurchase` costs roughly **575k gas**, the bulk of it the `0x0FD2` verification. Estimation
is unreliable on this chain — send with headroom.
