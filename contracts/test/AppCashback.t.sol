// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {PriceOracle} from "../src/PriceOracle.sol";
import {AppCashback} from "../src/AppCashback.sol";
import {MockQueryVerifier} from "../src/mocks/MockQueryVerifier.sol";
import {INativeQueryVerifier} from "../src/vendor/INativeQueryVerifier.sol";
import {TxFixture} from "./TxFixture.sol";

/// @notice The protocol-funded cashback stream: a percentage of spend set by level, priced in CTC
///         from an Attestcoin-proven Uniswap Sync.
contract AppCashbackTest is Test {
    uint64 constant CHAIN_KEY = 1;
    uint256 constant USD = 1e6;

    PriceOracle oracle;
    AppCashback cash;
    MockQueryVerifier verifier;

    address admin = address(0xA11CE);
    address core = address(0xC0DE);
    address user = address(0xD00D);
    address pair = address(0xDEAD00);

    INativeQueryVerifier.MerkleProof mp;
    INativeQueryVerifier.ContinuityProof cp;

    function setUp() public {
        vm.warp(1_800_000_000);
        verifier = new MockQueryVerifier();

        vm.startPrank(admin);
        oracle = new PriceOracle(CHAIN_KEY, address(verifier), admin);
        // CTC is token0, 18dp; the quote side is USDC, 6dp.
        oracle.setPair(pair, true, 18, 6);
        cash = new AppCashback(core, address(oracle), admin);
        vm.stopPrank();

        vm.deal(address(this), 1000 ether);
        cash.fund{value: 500 ether}();
    }

    function _pushRate(uint64 height, uint112 reserveCtc, uint112 reserveUsd) internal {
        verifier.setTxIndex(0);
        bytes memory txb = TxFixture.swapTx(pair, user, reserveCtc, reserveUsd);
        oracle.pushSyncProof(height, txb, mp, cp);
    }

    // ------------------------------------------------------------ the oracle

    function test_provenSyncSetsTheRate() public {
        // Pool holds 2000 CTC against 1000 USDC -> $1 buys 2 CTC.
        _pushRate(100, 2000 ether, uint112(1000 * USD));

        assertEq(oracle.ctcPerUsd(), 2 ether, "$1 = 2 CTC");
        assertEq(oracle.observedAtHeight(), 100);
        assertFalse(oracle.isManual(), "a proven rate is not an administered one");

        (uint256 rate, bool fresh) = oracle.readRate();
        assertEq(rate, 2 ether);
        assertTrue(fresh);
    }

    function test_aSyncFromAnotherContractIsIgnored() public {
        verifier.setTxIndex(0);
        // Same event signature, emitted by an impostor. Only the configured pair counts.
        bytes memory txb = TxFixture.swapTx(address(0xBADBAD), user, 9_000_000 ether, uint112(1 * USD));
        vm.expectRevert(PriceOracle.NoSyncFromPair.selector);
        oracle.pushSyncProof(100, txb, mp, cp);
    }

    function test_staleObservationCannotBeReplayed() public {
        _pushRate(200, 2000 ether, uint112(1000 * USD));

        // expectRevert binds to the very next call, so the proof call must be the next one.
        bytes memory txb = TxFixture.swapTx(pair, user, 4000 ether, uint112(1000 * USD));

        // Same height again must not overwrite a newer price...
        vm.expectRevert(abi.encodeWithSelector(PriceOracle.StaleHeight.selector, uint64(200), uint64(200)));
        oracle.pushSyncProof(200, txb, mp, cp);

        // ...nor an older one.
        vm.expectRevert(abi.encodeWithSelector(PriceOracle.StaleHeight.selector, uint64(150), uint64(200)));
        oracle.pushSyncProof(150, txb, mp, cp);

        assertEq(oracle.ctcPerUsd(), 2 ether, "the original observation stands");
    }

    function test_unverifiedProofIsRejected() public {
        verifier.setResult(false);
        bytes memory txb = TxFixture.swapTx(pair, user, 2000 ether, uint112(1000 * USD));
        vm.expectRevert(PriceOracle.NotVerified.selector);
        oracle.pushSyncProof(100, txb, mp, cp);
    }

    function test_rateGoesStale() public {
        _pushRate(100, 2000 ether, uint112(1000 * USD));
        vm.warp(block.timestamp + 7 hours);

        (, bool fresh) = oracle.readRate();
        assertFalse(fresh, "past maxAge the rate is not usable");
        assertEq(cash.quote(3, 100 * USD), 0, "and no cashback is quoted from it");
    }

    function test_absurdReserveRatioIsRejected() public {
        verifier.setTxIndex(0);
        bytes memory txb = TxFixture.swapTx(pair, user, 1 ether, uint112(1_000_000 * USD));
        vm.expectRevert(abi.encodeWithSelector(PriceOracle.RateOutOfBounds.selector, uint256(1e12)));
        oracle.pushSyncProof(100, txb, mp, cp);
    }

    // ------------------------------------------------------------ the ladder

    function test_levelLadderMatchesTheAdvertisedRates() public view {
        assertEq(cash.rateBpsForLevel(1), 0, "level 1 earns nothing");
        assertEq(cash.rateBpsForLevel(2), 200, "2%");
        assertEq(cash.rateBpsForLevel(3), 400, "4%");
        assertEq(cash.rateBpsForLevel(4), 700, "7%");
        assertEq(cash.rateBpsForLevel(5), 1000, "10%");
        assertEq(cash.rateBpsForLevel(9), 1000, "the top tier is a cap, not a step");
    }

    function test_cashbackIsAPercentageOfSpendInCtc() public {
        _pushRate(100, 2000 ether, uint112(1000 * USD)); // $1 = 2 CTC

        // Level 2 spending $10: 2% of $10 = $0.20 = 0.4 CTC.
        vm.prank(core);
        uint256 paid = cash.credit(user, 2, 10 * USD);
        assertEq(paid, 0.4 ether);
        assertEq(cash.claimable(user), 0.4 ether);

        // Level 5 spending the same $10: 10% = $1.00 = 2 CTC.
        vm.prank(core);
        assertEq(cash.credit(user, 5, 10 * USD), 2 ether);
    }

    function test_levelOneEarnsNothing() public {
        _pushRate(100, 2000 ether, uint112(1000 * USD));
        vm.prank(core);
        assertEq(cash.credit(user, 1, 100 * USD), 0);
        assertEq(cash.claimable(user), 0);
    }

    function test_creditNeverRevertsWithoutAPrice() public {
        // No proof pushed at all.
        vm.prank(core);
        uint256 paid = cash.credit(user, 5, 100 * USD);
        assertEq(paid, 0, "no price means no payout, not a failed purchase");
    }

    function test_treasuryIsAHardCap() public {
        _pushRate(100, 2000 ether, uint112(1000 * USD));

        vm.startPrank(admin);
        AppCashback small = new AppCashback(core, address(oracle), admin);
        vm.stopPrank();
        small.fund{value: 0.5 ether}();

        // 10% of $100 = $10 = 20 CTC owed, but only 0.5 CTC exists.
        vm.prank(core);
        uint256 paid = small.credit(user, 5, 100 * USD);
        assertEq(paid, 0.5 ether, "pays what it has");
        assertEq(small.totalClaimable(), 0.5 ether);

        vm.prank(core);
        assertEq(small.credit(user, 5, 100 * USD), 0, "and nothing once drained");
    }

    function test_onlyCoreCanCredit() public {
        _pushRate(100, 2000 ether, uint112(1000 * USD));
        vm.expectRevert(AppCashback.NotCore.selector);
        cash.credit(user, 5, 100 * USD);
    }

    function test_withdrawPaysOutAndClears() public {
        _pushRate(100, 2000 ether, uint112(1000 * USD));
        vm.prank(core);
        cash.credit(user, 5, 100 * USD); // 20 CTC

        uint256 before = user.balance;
        vm.prank(user);
        cash.withdraw();

        assertEq(user.balance - before, 20 ether);
        assertEq(cash.claimable(user), 0);
        assertEq(cash.totalClaimable(), 0);
    }

    function test_ownerCannotReclaimWhatIsOwed() public {
        _pushRate(100, 2000 ether, uint112(1000 * USD));
        vm.prank(core);
        cash.credit(user, 5, 100 * USD); // 20 CTC owed of 500

        vm.startPrank(admin);
        vm.expectRevert(AppCashback.NothingToReclaim.selector);
        cash.reclaim(481 ether);
        cash.reclaim(480 ether); // the unowed remainder is fine
        vm.stopPrank();

        vm.prank(user);
        cash.withdraw();
        assertEq(cash.claimable(user), 0, "the buyer is still paid in full");
    }

    function test_manualRateIsMarkedAsSuch() public {
        vm.prank(admin);
        oracle.setRateManually(3 ether);
        assertTrue(oracle.isManual(), "an administered rate must not look proven");

        // A later proof takes over and clears the flag.
        _pushRate(100, 2000 ether, uint112(1000 * USD));
        assertFalse(oracle.isManual());
        assertEq(oracle.ctcPerUsd(), 2 ether);
    }
}
