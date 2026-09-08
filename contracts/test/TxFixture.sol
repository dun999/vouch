// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {EvmV1Decoder} from "../src/vendor/EvmV1Decoder.sol";

/// @notice Builds `encodedTx` blobs in the exact layout EvmV1Decoder expects, so tests can vary
///         payer, payee, amount and receipt status. The layout is verified against real prover
///         bytes in DecoderTest.
library TxFixture {
    bytes32 internal constant TRANSFER_SIG = 0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef;
    /// keccak256("Sync(uint112,uint112)") -- emitted by every Uniswap V2 pair on every swap.
    bytes32 internal constant SYNC_SIG = 0x1c411e9a96e071241c2f21f7726b17ae89e3cab4c78be50e062b03a9fffbbad1;

    function pad(address a) internal pure returns (bytes32) {
        return bytes32(uint256(uint160(a)));
    }

    /// @notice One ERC-20 Transfer log.
    function transferLog(address token, address from, address to, uint256 amount)
        internal
        pure
        returns (EvmV1Decoder.LogEntryTuple memory l)
    {
        bytes32[] memory topics = new bytes32[](3);
        topics[0] = TRANSFER_SIG;
        topics[1] = pad(from);
        topics[2] = pad(to);
        l = EvmV1Decoder.LogEntryTuple({address_: token, topics: topics, data: abi.encode(amount)});
    }

    /// @notice A Uniswap V2 Sync log. Both reserves are unindexed, so they live in `data`.
    function syncLog(address pair, uint112 reserve0, uint112 reserve1)
        internal
        pure
        returns (EvmV1Decoder.LogEntryTuple memory l)
    {
        bytes32[] memory topics = new bytes32[](1);
        topics[0] = SYNC_SIG;
        l = EvmV1Decoder.LogEntryTuple({address_: pair, topics: topics, data: abi.encode(reserve0, reserve1)});
    }

    /// @notice A swap against `pair` that syncs the given reserves.
    function swapTx(address pair, address from, uint112 reserve0, uint112 reserve1)
        internal
        pure
        returns (bytes memory)
    {
        EvmV1Decoder.LogEntryTuple[] memory logs = new EvmV1Decoder.LogEntryTuple[](1);
        logs[0] = syncLog(pair, reserve0, reserve1);
        return build(from, pair, false, 0, 1, hex"", logs);
    }

    /// @dev Type-2 layout: abi.encode(uint8 txType, bytes[3]{common, typeSpecific, receipt}).
    function build(
        address from,
        address to,
        bool toIsNull,
        uint256 value,
        uint8 receiptStatus,
        bytes memory data,
        EvmV1Decoder.LogEntryTuple[] memory logs
    ) internal pure returns (bytes memory) {
        bytes[] memory chunks = new bytes[](3);
        chunks[0] = abi.encode(uint64(7), uint64(90000), from, toIsNull, to, value, data);
        chunks[1] = abi.encode(
            uint64(11155111), uint128(1 gwei), uint128(2 gwei),
            new EvmV1Decoder.AccessListEntryBytes32[](0), uint8(0), bytes32(0), bytes32(0)
        );
        chunks[2] = abi.encode(receiptStatus, uint64(65000), logs, bytes(""));
        return abi.encode(uint8(2), chunks);
    }

    /// @notice A successful USDC payment: a call into the token that emits one Transfer.
    function usdcPayment(address token, address from, address to, uint256 amount)
        internal
        pure
        returns (bytes memory)
    {
        EvmV1Decoder.LogEntryTuple[] memory logs = new EvmV1Decoder.LogEntryTuple[](1);
        logs[0] = transferLog(token, from, to, amount);
        // Real calldata would be transfer(address,uint256); its content is never trusted, only the log.
        return build(from, token, false, 0, 1, abi.encodeWithSignature("transfer(address,uint256)", to, amount), logs);
    }

    /// @notice A payment carrying several Transfer logs (e.g. a router or fee split).
    function usdcPaymentWithLogs(address token, address from, EvmV1Decoder.LogEntryTuple[] memory logs)
        internal
        pure
        returns (bytes memory)
    {
        return build(from, token, false, 0, 1, hex"", logs);
    }
}
