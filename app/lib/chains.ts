import { defineChain } from "viem";
import { sepolia } from "viem/chains";

/// Creditcoin CC3 testnet. chainId confirmed live via eth_chainId (0x18e8f).
export const creditcoinTestnet = defineChain({
  id: 102031,
  name: "Creditcoin CC3 Testnet",
  nativeCurrency: { name: "Creditcoin", symbol: "CTC", decimals: 18 },
  /// Overridable so the console can be pointed at a local node while iterating on the UI.
  rpcUrls: {
    default: { http: [process.env.NEXT_PUBLIC_CC_RPC || "https://rpc.cc3-testnet.creditcoin.network"] },
  },
  blockExplorers: {
    default: { name: "Creditcoin Explorer", url: "https://creditcoin-testnet.blockscout.com" },
  },
  testnet: true,
});

export { sepolia };

/// Attestcoin chain key for the source chain.
/// Confirmed live from get_supported_chains() on 0x0FD3:
///   [(3, 1, "Ethereum"), (1, 11155111, "Sepolia ethereum")]
/// Note the SDK's own doc comments show chainKey 1 as Ethereum MAINNET -- on CC3 testnet it is Sepolia.
export const SEPOLIA_CHAIN_KEY = 1;
/// Ethereum mainnet on CC3 testnet. Used by PriceOracle for Uniswap V2 Sync proofs.
export const ETHEREUM_CHAIN_KEY = 3;
/// Uniswap V2 WCTC (old) / USDT on Ethereum. No CTC/USDC V2 pair exists on mainnet.
export const MAINNET_WCTC_USDT_V2 = "0x4a4F4fcA1a9B673f9eB23b7EeFe9dFbafd8D8140" as const;

export const BLOCK_PROVER_PRECOMPILE = "0x0000000000000000000000000000000000000FD2" as const;
export const CHAIN_INFO_PRECOMPILE = "0x0000000000000000000000000000000000000fd3" as const;

/// Primary is the officially documented endpoint; the other is the one used in the SDK docs.
/// Both were verified to serve identical proofs, so we fall back rather than fail the demo.
export const PROVER_URLS = [
  "https://proof-gen-api.cc3-testnet.creditcoin.network",
  "https://prover.cc3-testnet.creditcoin.network",
];

/// Sepolia blocks are ~12s and attestation trailed head by ~43 blocks when measured.
export const SEPOLIA_BLOCK_SECONDS = 12;

/// Blockscout's JSON-RPC mirror of the same chain. The primary node answers a 50k-block
/// `eth_getLogs` in ~30s and rejects anything wider outright; Blockscout answers the full range
/// in well under a second. Provenance lookups go here, everything else stays on the node.
export const CC_LOGS_RPC = "https://creditcoin-testnet.blockscout.com/api/eth-rpc";

const CC_EXPLORER = creditcoinTestnet.blockExplorers.default.url;
const SEPOLIA_EXPLORER = "https://sepolia.etherscan.io";

export const ccTxUrl = (hash: string) => `${CC_EXPLORER}/tx/${hash}`;
export const ccAddressUrl = (addr: string) => `${CC_EXPLORER}/address/${addr}`;
export const ccBlockUrl = (n: bigint | number | string) => `${CC_EXPLORER}/block/${n}`;

export const sepoliaTxUrl = (hash: string) => `${SEPOLIA_EXPLORER}/tx/${hash}`;
export const sepoliaAddressUrl = (addr: string) => `${SEPOLIA_EXPLORER}/address/${addr}`;
export const sepoliaBlockUrl = (n: bigint | number | string) => `${SEPOLIA_EXPLORER}/block/${n}`;
