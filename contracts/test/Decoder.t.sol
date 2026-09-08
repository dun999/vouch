// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {EvmV1Decoder} from "../src/vendor/EvmV1Decoder.sol";

/// @notice M0: proves EvmV1Decoder yields the fields VouchCore must trust, using REAL prover
///         `txBytes` for a real Sepolia ETH transfer (block 11658200, txIndex 4).
contract DecoderTest is Test {
    bytes txBytes;

    // Ground truth read straight from Sepolia via eth_getBlockByNumber.
    address constant EXPECT_FROM = 0x6Cc9397c3B38739daCbfaA68EaD5F5D77Ba5F455;
    address constant EXPECT_TO = 0x449b2184091e57363231d163D210Beb2F6c3f803;
    uint256 constant EXPECT_VALUE = 2500000000000000000;

    function setUp() public {
        txBytes = vm.parseJsonBytes(vm.readFile("./test/fixtures/sepolia-transfer.json"), ".txBytes");
    }

    function test_decodesRealSepoliaTransfer() public view {
        EvmV1Decoder.CommonTxFields memory c = EvmV1Decoder.decodeCommonTxFields(txBytes);

        assertEq(EvmV1Decoder.getTransactionType(txBytes), 2, "EIP-1559 tx");
        assertEq(c.from, EXPECT_FROM, "payer");
        assertEq(c.to, EXPECT_TO, "merchant payout address");
        assertFalse(c.toIsNull, "not a contract creation");
        assertEq(c.value, EXPECT_VALUE, "purchase amount in wei");
        assertEq(c.data.length, 0, "plain transfer, no calldata");
    }

    function test_receiptStatusIsSuccess() public view {
        // The precompile does NOT check this -- VouchCore must, or a reverted payment earns XP.
        EvmV1Decoder.ReceiptFields memory r = EvmV1Decoder.decodeReceiptFields(txBytes);
        assertEq(r.receiptStatus, 1, "tx succeeded");
    }
}
