// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Ownable} from "openzeppelin-contracts/access/Ownable.sol";
import {INativeQueryVerifier, NativeQueryVerifierLib} from "./vendor/INativeQueryVerifier.sol";
import {EvmV1Decoder} from "./vendor/EvmV1Decoder.sol";

/// @title PriceOracle
/// @notice How many CTC one US dollar buys, read out of a Uniswap V2 pool on the source chain and
///         proven to Creditcoin by Attestcoin.
///
/// @dev App cashback is quoted as a percentage of spend, but paid in CTC. Something has to convert
///      dollars to CTC, and a signed price feed would put a trusted operator in the middle of a
///      protocol whose whole point is that nothing is trusted.
///
///      A Uniswap V2 pair emits `Sync(uint112 reserve0, uint112 reserve1)` on every swap, carrying
///      the pool's reserves at that block. That is a price observation sitting in a transaction
///      receipt — exactly the shape Attestcoin already proves for payments. So the same precompile,
///      the same decoder and the same trust model give us a rate: whoever pushes the proof cannot
///      forge the reserves, and cannot make up a block that did not happen.
///
///      Two guards make a proven number safe to use:
///        1. The `Sync` must come from the configured pair. Any contract can emit that signature.
///        2. Heights must strictly increase, so nobody can replay a stale, favourable observation.
contract PriceOracle is Ownable {
    /// @dev keccak256("Sync(uint112,uint112)")
    bytes32 internal constant SYNC_SIG = 0x1c411e9a96e071241c2f21f7726b17ae89e3cab4c78be50e062b03a9fffbbad1;

    INativeQueryVerifier public immutable VERIFIER;
    uint64 public immutable CHAIN_KEY;

    /// @notice The Uniswap V2 pair to read, on the source chain. Zero means "not configured".
    address public pair;
    /// @notice Whether CTC (or its source-chain representation) is token0 of that pair.
    bool public ctcIsToken0;
    uint8 public ctcDecimals = 18;
    uint8 public usdDecimals = 6;

    /// @notice CTC wei per one whole US dollar. 2e18 means $1 buys 2 CTC.
    uint256 public ctcPerUsd;
    /// @notice Source-chain height of the observation behind `ctcPerUsd`.
    uint64 public observedAtHeight;
    /// @notice Creditcoin timestamp when it was recorded.
    uint64 public updatedAt;
    /// @notice True when the current rate came from the owner rather than a proof.
    bool public isManual;

    /// @notice How long a rate stays usable. Past this, consumers should treat it as unset.
    uint256 public maxAge = 6 hours;

    /// @dev Sanity band. A pool can be manipulated within a block; these bounds stop a single
    ///      absurd observation from draining the cashback treasury before anyone notices.
    uint256 public minRate = 0.01 ether;
    uint256 public maxRate = 10_000 ether;

    event PairSet(address pair, bool ctcIsToken0, uint8 ctcDecimals, uint8 usdDecimals);
    event RateProven(uint256 ctcPerUsd, uint64 height, uint112 reserveCtc, uint112 reserveUsd);
    event RateSetManually(uint256 ctcPerUsd);
    event BoundsSet(uint256 minRate, uint256 maxRate, uint256 maxAge);

    error NotVerified();
    error SourceTxFailed();
    error PairNotSet();
    error NoSyncFromPair();
    error StaleHeight(uint64 given, uint64 have);
    error EmptyReserves();
    error RateOutOfBounds(uint256 rate);

    constructor(uint64 chainKey, address verifier_, address initialOwner) Ownable(initialOwner) {
        CHAIN_KEY = chainKey;
        VERIFIER = INativeQueryVerifier(verifier_ == address(0) ? NativeQueryVerifierLib.PRECOMPILE : verifier_);
    }

    // ---------------------------------------------------------------- proving

    /// @notice Prove a source-chain transaction that touched the configured pair, and take the
    ///         reserves it synced as the current rate.
    /// @dev Permissionless on purpose. There is nothing to gain from pushing an honest price, and
    ///      a dishonest one is not representable: the reserves come out of a proven receipt.
    function pushSyncProof(
        uint64 height,
        bytes calldata encodedTx,
        INativeQueryVerifier.MerkleProof calldata merkleProof,
        INativeQueryVerifier.ContinuityProof calldata continuityProof
    ) external returns (uint256 rate) {
        if (pair == address(0)) revert PairNotSet();
        // Only ever move forward, so a stale observation cannot be replayed once the price moves.
        if (height <= observedAtHeight) revert StaleHeight(height, observedAtHeight);

        if (!VERIFIER.verifyAndEmit(CHAIN_KEY, height, encodedTx, merkleProof, continuityProof)) {
            revert NotVerified();
        }

        // Inclusion is not success: a reverted swap still gets included, and its logs are not state.
        EvmV1Decoder.ReceiptFields memory r = EvmV1Decoder.decodeReceiptFields(encodedTx);
        if (r.receiptStatus != 1) revert SourceTxFailed();

        (uint112 reserveCtc, uint112 reserveUsd) = _readSync(r);
        rate = _quote(reserveCtc, reserveUsd);

        ctcPerUsd = rate;
        observedAtHeight = height;
        updatedAt = uint64(block.timestamp);
        isManual = false;

        emit RateProven(rate, height, reserveCtc, reserveUsd);
    }

    /// @dev Pulls the Sync emitted *by the configured pair*. Any contract may emit that signature,
    ///      so the emitter address is what makes the number mean anything.
    function _readSync(EvmV1Decoder.ReceiptFields memory r)
        private
        view
        returns (uint112 reserveCtc, uint112 reserveUsd)
    {
        EvmV1Decoder.LogEntry[] memory logs = EvmV1Decoder.getLogsByEventSignature(r, SYNC_SIG);
        address p = pair;

        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].address_ != p) continue;
            (uint112 r0, uint112 r1) = abi.decode(logs[i].data, (uint112, uint112));
            if (r0 == 0 || r1 == 0) revert EmptyReserves();
            return ctcIsToken0 ? (r0, r1) : (r1, r0);
        }
        revert NoSyncFromPair();
    }

    /// @dev CTC wei per whole USD = 1e18 * (reserveCtc / 10^ctcDec) / (reserveUsd / 10^usdDec).
    function _quote(uint112 reserveCtc, uint112 reserveUsd) private view returns (uint256 rate) {
        rate = (uint256(reserveCtc) * (10 ** usdDecimals) * 1e18) / (uint256(reserveUsd) * (10 ** ctcDecimals));
        if (rate < minRate || rate > maxRate) revert RateOutOfBounds(rate);
    }

    // ---------------------------------------------------------------- reading

    /// @notice The rate, and whether it is fresh enough to spend against.
    /// @dev Consumers must honour `fresh`. A stale rate is not a small error — it is the wrong
    ///      number, and cashback is paid out of a real treasury.
    function readRate() external view returns (uint256 rate, bool fresh) {
        rate = ctcPerUsd;
        fresh = rate != 0 && block.timestamp <= uint256(updatedAt) + maxAge;
    }

    /// @notice What `usdcAmount` (in the payment token's base units) is worth in CTC right now.
    function ctcForUsdc(uint256 usdcAmount, uint8 paymentDecimals) external view returns (uint256) {
        if (ctcPerUsd == 0) return 0;
        return (usdcAmount * ctcPerUsd) / (10 ** paymentDecimals);
    }

    // ---------------------------------------------------------------- admin

    function setPair(address pair_, bool ctcIsToken0_, uint8 ctcDecimals_, uint8 usdDecimals_) external onlyOwner {
        pair = pair_;
        ctcIsToken0 = ctcIsToken0_;
        ctcDecimals = ctcDecimals_;
        usdDecimals = usdDecimals_;
        // A new pair invalidates the old observation, and its heights are unrelated.
        observedAtHeight = 0;
        emit PairSet(pair_, ctcIsToken0_, ctcDecimals_, usdDecimals_);
    }

    /// @notice Fallback for when no CTC/USD pool exists on the source chain yet.
    /// @dev Deliberately marked `isManual` so the app can say so out loud rather than passing an
    ///      administered number off as a proven one.
    function setRateManually(uint256 rate) external onlyOwner {
        if (rate < minRate || rate > maxRate) revert RateOutOfBounds(rate);
        ctcPerUsd = rate;
        updatedAt = uint64(block.timestamp);
        isManual = true;
        emit RateSetManually(rate);
    }

    function setBounds(uint256 minRate_, uint256 maxRate_, uint256 maxAge_) external onlyOwner {
        minRate = minRate_;
        maxRate = maxRate_;
        maxAge = maxAge_;
        emit BoundsSet(minRate_, maxRate_, maxAge_);
    }
}
