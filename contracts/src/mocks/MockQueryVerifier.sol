// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {INativeQueryVerifier} from "../vendor/INativeQueryVerifier.sol";

/// @notice Stand-in for the 0x0FD2 precompile so VouchCore logic is testable locally.
/// @dev Only the proof *outcome* is faked. The `encodedTx` fed to it is real prover output (or
///      built to the same layout), so EvmV1Decoder is still exercised for real.
contract MockQueryVerifier {
    bool public result = true;
    uint64 public txIndex;
    bool public shouldRevert;

    function setResult(bool r) external { result = r; }
    function setTxIndex(uint64 i) external { txIndex = i; }
    function setShouldRevert(bool r) external { shouldRevert = r; }

    function verifyAndEmit(
        uint64,
        uint64,
        bytes calldata,
        INativeQueryVerifier.MerkleProof calldata,
        INativeQueryVerifier.ContinuityProof calldata
    ) external view returns (bool) {
        require(!shouldRevert, "mock: proof rejected");
        return result;
    }

    function verify(
        uint64,
        uint64,
        bytes calldata,
        INativeQueryVerifier.MerkleProof calldata,
        INativeQueryVerifier.ContinuityProof calldata
    ) external view returns (bool) {
        require(!shouldRevert, "mock: proof rejected");
        return result;
    }

    function calculateTxIndex(INativeQueryVerifier.MerkleProof calldata) external view returns (uint64) {
        return txIndex;
    }
}
