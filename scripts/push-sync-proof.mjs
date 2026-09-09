#!/usr/bin/env node
/**
 * Push an Attestcoin-proven Uniswap V2 Sync from Ethereum mainnet into PriceOracle.
 *
 *   PRICE_ORACLE=0x… PRIVATE_KEY=0x… node scripts/push-sync-proof.mjs [txHash]
 *
 * If no tx hash is given, picks the latest Sync on the configured pair that Attestcoin has
 * already attested (chain key 3). Payments stay on Sepolia; this path is price observations only.
 */
import { Contract, JsonRpcProvider, Wallet, formatEther } from "ethers";
import { readFileSync } from "node:fs";

const CREDITCOIN_RPC = process.env.CREDITCOIN_RPC_URL ?? "https://rpc.cc3-testnet.creditcoin.network";
const ETH_RPCS = [
  process.env.ETH_RPC_URL,
  "https://ethereum.publicnode.com",
  "https://eth.meowrpc.com",
  "https://rpc.mevblocker.io",
  "https://1rpc.io/eth",
].filter(Boolean);
const PROVERS = [
  "https://proof-gen-api.cc3-testnet.creditcoin.network",
  "https://prover.cc3-testnet.creditcoin.network",
];
const ETHEREUM_CHAIN_KEY = 3;
const SYNC_SIG = "0x1c411e9a96e071241c2f21f7726b17ae89e3cab4c78be50e062b03a9fffbbad1";
const CHAIN_INFO = "0x0000000000000000000000000000000000000fd3";
const PAIR_FALLBACK = "0x4a4F4fcA1a9B673f9eB23b7EeFe9dFbafd8D8140";

const oracleAddr = process.env.PRICE_ORACLE;
const pk = process.env.PRIVATE_KEY;
const givenTx = process.argv[2];

if (!oracleAddr || !pk) {
  console.error("PRICE_ORACLE and PRIVATE_KEY must be set.");
  process.exit(1);
}

const oracleAbi = JSON.parse(readFileSync("contracts/out/PriceOracle.sol/PriceOracle.json", "utf8")).abi;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function ethCall(method, params, timeout = 20_000) {
  let last;
  for (const url of ETH_RPCS) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", "user-agent": "vouch-sync/1" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        signal: AbortSignal.timeout(timeout),
      });
      const body = await res.json();
      if (body.error) throw new Error(body.error.message ?? JSON.stringify(body.error));
      return body.result;
    } catch (e) {
      last = e;
    }
  }
  throw last ?? new Error("no Ethereum RPC answered");
}

async function fetchProof(hash) {
  for (const base of PROVERS) {
    try {
      const res = await fetch(`${base}/api/v1/proof-by-tx/${ETHEREUM_CHAIN_KEY}/${hash}`);
      if (res.ok) return await res.json();
    } catch {
      /* next host */
    }
  }
  return null;
}

async function latestAttestedHeight(cc) {
  const data = await cc.call({
    to: CHAIN_INFO,
    data: "0x809112da" + ETHEREUM_CHAIN_KEY.toString(16).padStart(64, "0"),
  });
  // (uint64 height, bytes32 hash, bool ok) — height is the first 32-byte word.
  return Number(BigInt(data.slice(0, 66)));
}

async function findLatestAttestedSync(pair, attested) {
  const span = 50;
  for (let to = attested; to > attested - 20_000; to -= span) {
    const from = Math.max(0, to - span + 1);
    try {
      const logs = await ethCall("eth_getLogs", [
        {
          fromBlock: "0x" + from.toString(16),
          toBlock: "0x" + to.toString(16),
          address: pair,
          topics: [SYNC_SIG],
        },
      ]);
      if (logs?.length) {
        const last = logs[logs.length - 1];
        return {
          txHash: last.transactionHash,
          block: Number(last.blockNumber),
        };
      }
    } catch {
      /* try the next window */
    }
  }
  return null;
}

const main = async () => {
  const cc = new JsonRpcProvider(CREDITCOIN_RPC, 102031, { staticNetwork: true });
  const wallet = new Wallet(pk, cc);
  const oracle = new Contract(oracleAddr, oracleAbi, wallet);

  const chainKey = await oracle.CHAIN_KEY();
  const pair = (await oracle.pair()) || PAIR_FALLBACK;
  if (chainKey !== BigInt(ETHEREUM_CHAIN_KEY)) {
    throw new Error(`oracle CHAIN_KEY is ${chainKey}, expected ${ETHEREUM_CHAIN_KEY} (Ethereum mainnet)`);
  }
  if (pair === "0x0000000000000000000000000000000000000000") {
    throw new Error("oracle pair is unset; run ConfigureMainnetOracle first");
  }

  const attested = await latestAttestedHeight(cc);
  console.log(`oracle     ${oracleAddr}`);
  console.log(`pair       ${pair}`);
  console.log(`attested   Ethereum height ${attested}`);

  let txHash = givenTx;
  let height;
  if (txHash) {
    if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) throw new Error("invalid tx hash");
    const receipt = await ethCall("eth_getTransactionReceipt", [txHash]);
    if (!receipt) throw new Error("Ethereum receipt not found");
    height = Number(receipt.blockNumber);
  } else {
    const found = await findLatestAttestedSync(pair, attested);
    if (!found) throw new Error("no attested Sync found on the configured pair");
    txHash = found.txHash;
    height = found.block;
  }
  console.log(`sync tx    ${txHash}`);
  console.log(`sync block ${height}`);
  if (height > attested) {
    throw new Error(`Sync block ${height} is ahead of attested height ${attested}; wait for Attestcoin`);
  }

  let proof = await fetchProof(txHash);
  for (let i = 0; i < 12 && !proof; i++) {
    process.stdout.write(`\rwaiting for prover cache… ${i * 15}s`);
    await sleep(15_000);
    proof = await fetchProof(txHash);
  }
  if (!proof) throw new Error("prover did not serve a chain-key-3 proof for this Sync");
  console.log(`\nproof      height ${proof.headerNumber}, txIndex ${proof.txIndex}`);

  const args = [
    proof.headerNumber,
    proof.txBytes,
    { root: proof.merkleProof.root, siblings: proof.merkleProof.siblings },
    {
      lowerEndpointDigest: proof.continuityProof.lowerEndpointDigest,
      roots: proof.continuityProof.roots,
    },
  ];

  let gasLimit = 5_000_000n;
  try {
    gasLimit = ((await oracle.pushSyncProof.estimateGas(...args)) * 300n) / 100n;
  } catch (e) {
    console.log(`  (gas estimation failed, using fallback: ${e.shortMessage ?? e.message})`);
  }
  console.log(`gas limit  ${gasLimit}`);

  const tx = await oracle.pushSyncProof(...args, { gasLimit });
  console.log(`submitted  ${tx.hash}`);
  const receipt = await tx.wait();
  console.log(`mined      status ${receipt.status} gasUsed ${receipt.gasUsed}`);

  const [rate, fresh] = await oracle.readRate();
  const isManual = await oracle.isManual();
  console.log(`ctcPerUsd  ${formatEther(rate)} CTC / $1`);
  console.log(`fresh      ${fresh}`);
  console.log(`isManual   ${isManual}`);
};

main().catch((e) => {
  console.error(`\nfailed: ${e.shortMessage ?? e.message}`);
  process.exit(1);
});
