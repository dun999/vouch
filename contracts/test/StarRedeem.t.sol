// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {CommerceRegistry} from "../src/CommerceRegistry.sol";
import {BenefitPass} from "../src/BenefitPass.sol";
import {VouchCore} from "../src/VouchCore.sol";
import {StarRedeem} from "../src/StarRedeem.sol";
import {MockQueryVerifier} from "../src/mocks/MockQueryVerifier.sol";
import {INativeQueryVerifier} from "../src/vendor/INativeQueryVerifier.sol";
import {TxFixture} from "./TxFixture.sol";

/// Exercise redemption against a real VouchCore: stars are earned through verified (mocked)
/// Sepolia payments, then spent through StarRedeem without touching VouchCore's ledger.
contract StarRedeemTest is Test {
    uint64 constant CHAIN_KEY = 1;
    uint256 constant USD = 1e6;

    CommerceRegistry registry;
    BenefitPass pass;
    VouchCore core;
    StarRedeem redeem;
    MockQueryVerifier verifier;

    address admin = address(0xA11CE);
    address payout = address(0xCAFE);
    address user = address(0xD00D);
    address token = address(0x05DC);

    INativeQueryVerifier.MerkleProof mp;
    INativeQueryVerifier.ContinuityProof cp;

    function setUp() public {
        vm.warp(1_800_000_000);

        registry = new CommerceRegistry();
        verifier = new MockQueryVerifier();

        vm.startPrank(admin);
        pass = new BenefitPass(admin);
        core = new VouchCore(CHAIN_KEY, address(registry), address(pass), address(verifier), admin);
        pass.setMinter(address(core));
        core.setPaymentToken(token, 6);
        redeem = new StarRedeem(address(core), admin);
        vm.stopPrank();

        vm.prank(address(0xBEEF));
        registry.register("Coffee Bar", "ipfs://meta", payout);

        vm.deal(address(this), 1000 ether);
        redeem.fund{value: 100 ether}();
    }

    /// Earn `usdAmount` of verified spend for `who` at a fresh height/txIndex.
    function _earn(address who, uint256 usdAmount, uint64 height) internal {
        verifier.setTxIndex(0);
        bytes memory txb = TxFixture.usdcPayment(token, who, payout, usdAmount);
        vm.prank(who);
        core.recordPurchase(height, txb, mp, cp, 0, new uint256[](0));
    }

    function test_spendableIsStarsAboveFloor() public {
        _earn(user, 8 * USD, 100); // 80 stars: below the 700 floor
        assertEq(redeem.spendableOf(user), 0);

        _earn(user, 72 * USD, 101); // 800 total
        assertEq(redeem.spendableOf(user), 100);
    }

    function test_redeemPaysCtcAtHundredToTen() public {
        _earn(user, 80 * USD, 100); // 800 stars, 100 spendable
        assertEq(redeem.quote(100), 10 ether);

        uint256 before = user.balance;
        vm.prank(user);
        redeem.redeem(100);

        assertEq(user.balance - before, 10 ether);
        assertEq(redeem.redeemed(user), 100);
        assertEq(redeem.spendableOf(user), 0, "floor of 700 stays untouched");
    }

    function test_redeemRevertsAboveSpendable() public {
        _earn(user, 80 * USD, 100);
        vm.prank(user);
        vm.expectRevert(abi.encodeWithSelector(StarRedeem.AboveSpendable.selector, 101, 100));
        redeem.redeem(101);
    }

    function test_redeemRevertsOnZero() public {
        vm.prank(user);
        vm.expectRevert(StarRedeem.ZeroAmount.selector);
        redeem.redeem(0);
    }

    function test_ledgerAllowsRepeatedRedemptions() public {
        _earn(user, 90 * USD, 100); // 900 stars, 200 spendable
        vm.startPrank(user);
        redeem.redeem(100);
        redeem.redeem(100);
        vm.expectRevert(abi.encodeWithSelector(StarRedeem.AboveSpendable.selector, 1, 0));
        redeem.redeem(1);
        vm.stopPrank();
        assertEq(redeem.redeemed(user), 200);
    }

    function test_redemptionNeverLowersLevel() public {
        _earn(user, 80 * USD, 100);
        assertEq(core.levelOf(user), 5);
        vm.prank(user);
        redeem.redeem(100);
        assertEq(core.levelOf(user), 5, "stars stay in VouchCore; only the redeem ledger moves");
        assertEq(core.starsOf(user), 800);
    }

    function test_redeemRevertsWhenTreasuryShort() public {
        StarRedeem poor = new StarRedeem(address(core), admin);
        poor.fund{value: 1 ether}();
        _earn(user, 80 * USD, 100);
        vm.prank(user);
        vm.expectRevert(
            abi.encodeWithSelector(StarRedeem.InsufficientTreasury.selector, 10 ether, 1 ether)
        );
        poor.redeem(100);
    }

    function test_ownerCanUpdateRateAndFloor() public {
        vm.prank(admin);
        redeem.setRate(0.2 ether);
        assertEq(redeem.quote(100), 20 ether);

        vm.prank(admin);
        redeem.setFloor(500);
        _earn(user, 60 * USD, 100); // 600 stars
        assertEq(redeem.spendableOf(user), 100);

        vm.prank(user);
        vm.expectRevert();
        redeem.setRate(0.1 ether);
    }

    function test_ownerCanWithdrawTreasury() public {
        uint256 before = admin.balance;
        vm.prank(admin);
        redeem.withdraw(40 ether);
        assertEq(admin.balance - before, 40 ether);
        assertEq(redeem.treasury(), 60 ether);
    }
}
