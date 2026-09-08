// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {INativeQueryVerifier, NativeQueryVerifierLib} from "./vendor/INativeQueryVerifier.sol";
import {EvmV1Decoder} from "./vendor/EvmV1Decoder.sol";

/// @title DecoderProbe
/// @notice Throwaway M0 rig. Proves the Attestcoin pipe end to end before any Vouch logic exists:
///         a real Sepolia transfer -> prover proof -> 0x0FD2 -> decoded from/to/value/status.
/// @dev Deliberately does no Vouch bookkeeping. Delete once VouchCore lands.
contract DecoderProbe {
    /// @dev Mirrors exactly what VouchCore.recordPurchase will need to trust.
    event Probed(
        uint64 chainKey,
        uint64 height,
        uint64 txIndex,
        address from,
        address to,
        bool toIsNull,
        uint256 value,
        uint8 receiptStatus,
        uint256 dataLength,
        uint256 logCount
    );

    INativeQueryVerifier public constant VERIFIER = INativeQueryVerifier(NativeQueryVerifierLib.PRECOMPILE);

    /// @notice State-changing so the precompile's own `TransactionVerified` event is emitted too;
    ///         compare its `transactionIndex` against our `calculateTxIndex` reading.
    function probe(
        uint64 chainKey,
        uint64 height,
        bytes calldata encodedTx,
        INativeQueryVerifier.MerkleProof calldata merkleProof,
        INativeQueryVerifier.ContinuityProof calldata continuityProof
    ) external returns (bool) {
        bool verified = VERIFIER.verifyAndEmit(chainKey, height, encodedTx, merkleProof, continuityProof);
        require(verified, "probe: not verified");

        EvmV1Decoder.CommonTxFields memory c = EvmV1Decoder.decodeCommonTxFields(encodedTx);
        EvmV1Decoder.ReceiptFields memory r = EvmV1Decoder.decodeReceiptFields(encodedTx);

        emit Probed(
            chainKey,
            height,
            VERIFIER.calculateTxIndex(merkleProof),
            c.from,
            c.to,
            c.toIsNull,
            c.value,
            r.receiptStatus,
            c.data.length,
            r.receiptLogs.length
        );
        return true;
    }

    /// @notice Read-only decode with no proof, to sanity-check `txBytes` shape off-chain first.
    function decodeOnly(bytes calldata encodedTx)
        external
        pure
        returns (uint8 txType, address from, address to, bool toIsNull, uint256 value, uint8 receiptStatus)
    {
        EvmV1Decoder.CommonTxFields memory c = EvmV1Decoder.decodeCommonTxFields(encodedTx);
        EvmV1Decoder.ReceiptFields memory r = EvmV1Decoder.decodeReceiptFields(encodedTx);
        return (EvmV1Decoder.getTransactionType(encodedTx), c.from, c.to, c.toIsNull, c.value, r.receiptStatus);
    }
}
