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
| **Sepolia chainKey** | **`1`** |
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

# how far behind is attestation?
cast call 0x0000000000000000000000000000000000000FD3 \
  "get_latest_attestation_height_and_hash(uint64)(uint64,bytes32,bool)" 1 \
  --rpc-url https://rpc.cc3-testnet.creditcoin.network

# fetch a real proof
curl "https://prover.cc3-testnet.creditcoin.network/api/v1/proof-by-tx/1/<txHash>"
```

`contracts/test/fixtures/sepolia-transfer.json` is a real proof for a real Sepolia ETH transfer
(block 11658200, txIndex 4, 2.5 ETH). Its `verify()` returns `true` on the live precompile, and the
test suite decodes it with the real `EvmV1Decoder`.

## Deployed (CC3 testnet, chainId 102031)

| Contract | Address |
|---|---|
| CommerceRegistry | `0xbB54d51f8bDA5B9bBb0364e8e555a5623850f66d` |
| BenefitPass | `0xBcb107E49F78C9dBa122eA31137B6ED903F65AeC` |
| VouchCore | `0x5F356e04bB11651eD083Ca9b6abF19fe4bE26855` |
| QuestManager | `0x361E1e7E26267207185d96e617Aae44d7F93d517` |
| RewardVault | `0x3a1081e9B494Af63d254cf64f90189ea85481f9E` |

`VouchCore.VERIFIER` is bound to the real precompile `0x0FD2` and `CHAIN_KEY` is `1`.

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
