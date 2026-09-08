// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {CommerceRegistry} from "../src/CommerceRegistry.sol";
import {BenefitPass} from "../src/BenefitPass.sol";
import {VouchCore} from "../src/VouchCore.sol";
import {QuestManager} from "../src/QuestManager.sol";
import {RewardVault} from "../src/RewardVault.sol";
import {MilestoneManager} from "../src/MilestoneManager.sol";
import {Catalog} from "../src/Catalog.sol";
import {PriceOracle} from "../src/PriceOracle.sol";
import {AppCashback} from "../src/AppCashback.sol";
import {MockQueryVerifier} from "../src/mocks/MockQueryVerifier.sol";
import {INativeQueryVerifier} from "../src/vendor/INativeQueryVerifier.sol";
import {EvmV1Decoder} from "../src/vendor/EvmV1Decoder.sol";
import {TxFixture} from "./TxFixture.sol";

contract VouchCoreTest is Test {
    uint64 constant CHAIN_KEY = 1; // Sepolia on CC3
    uint256 constant USD = 1e6; // USDC has 6 decimals

    CommerceRegistry registry;
    BenefitPass pass;
    VouchCore core;
    QuestManager quests;
    RewardVault vault;
    MilestoneManager milestones;
    Catalog catalog;
    PriceOracle oracle;
    AppCashback appCash;
    MockQueryVerifier verifier;

    address admin = address(0xA11CE);
    address merchant = address(0xBEEF);
    address payout = address(0xCAFE); // merchant's Sepolia address
    address user = address(0xD00D);
    address token = address(0x05DC); // MockUSDC on Sepolia
    uint256 commerceId;

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
        vm.stopPrank();

        quests = new QuestManager(address(registry), address(core));
        vault = new RewardVault(address(registry), address(core));
        milestones = new MilestoneManager(address(registry), address(core));
        catalog = new Catalog(address(registry), address(core));

        vm.startPrank(admin);
        oracle = new PriceOracle(CHAIN_KEY, address(verifier), admin);
        oracle.setRateManually(2 ether); // $1 = 2 CTC
        appCash = new AppCashback(address(core), address(oracle), admin);
        vm.stopPrank();
        vm.deal(address(this), 2000 ether);
        appCash.fund{value: 200 ether}();

        vm.startPrank(admin);
        core.setAppCashback(address(appCash));
        core.setPaymentToken(token, 6);
        core.setQuestManager(address(quests));
        core.setRewardVault(address(vault));
        core.setMilestoneManager(address(milestones));
        core.setCatalog(address(catalog));
        vm.stopPrank();

        vm.prank(merchant);
        commerceId = registry.register("Coffee Bar", "ipfs://meta", payout);
    }

    function _claim(address who, uint256 amount, uint64 height, uint64 txIndex, uint256[] memory qids)
        internal
        returns (uint256)
    {
        verifier.setTxIndex(txIndex);
        bytes memory txb = TxFixture.usdcPayment(token, who, payout, amount);
        vm.prank(who);
        return core.recordPurchase(height, txb, mp, cp, 0, qids);
    }

    /// Same as `_claim`, but the payment names a catalog item.
    function _claimItem(
        address who,
        uint256 amount,
        uint64 height,
        uint64 txIndex,
        uint256 itemId,
        uint256[] memory qids
    ) internal returns (uint256) {
        verifier.setTxIndex(txIndex);
        bytes memory txb = TxFixture.usdcPayment(token, who, payout, amount);
        vm.prank(who);
        return core.recordPurchase(height, txb, mp, cp, itemId, qids);
    }

    function _noQuests() internal pure returns (uint256[] memory) {
        return new uint256[](0);
    }

    function _receipt(uint256 id) internal view returns (VouchCore.Receipt memory) {
        return core.getReceipt(id);
    }

    // ------------------------------------------------------------ fixture sanity

    function test_fixtureMatchesDecoderLayout() public pure {
        bytes memory txb = TxFixture.usdcPayment(address(0x05DC), address(0x1234), address(0x5678), 25 * 1e6);
        EvmV1Decoder.CommonTxFields memory c = EvmV1Decoder.decodeCommonTxFields(txb);
        assertEq(c.from, address(0x1234));
        assertEq(c.to, address(0x05DC), "tx goes to the token, not the merchant");
        assertEq(c.value, 0, "ERC-20 payment carries no native value");

        EvmV1Decoder.ReceiptFields memory r = EvmV1Decoder.decodeReceiptFields(txb);
        assertEq(r.receiptStatus, 1);
        assertEq(r.receiptLogs.length, 1);
        assertEq(r.receiptLogs[0].topics[0], TxFixture.TRANSFER_SIG);
    }

    // ------------------------------------------------------------ happy path

    function test_verifiedPurchaseAwardsXpByDollarsSpent() public {
        _claim(user, 10 * USD, 100, 0, _noQuests()); // $10

        VouchCore.Profile memory p = core.profileOf(user);
        assertEq(p.stars, 100, "$10 x 10 XP, no flat bonus");
        assertEq(p.verifiedSpend, 10 * USD);
        assertEq(p.purchaseCount, 1);
        assertEq(p.level, 2, "100 XP crosses the 50 threshold");
        assertTrue(pass.hasPass(user));
    }

    function test_xpScalesWithSpend() public {
        _claim(user, 1 * USD, 100, 0, _noQuests()); // $1 -> 10 XP
        assertEq(core.profileOf(user).stars, 10);

        _claim(user, 3 * USD, 101, 0, _noQuests()); // $3 -> 30 XP
        assertEq(core.profileOf(user).stars, 40);
    }

    /// XP is a pure function of verified spend: same dollars, same XP, however it is split up.
    function test_xpIsPurelySpendAndIgnoresPurchaseCount() public {
        _claim(user, 4 * USD, 100, 0, _noQuests());
        uint256 oneShot = core.profileOf(user).stars;

        address other = address(0xB0B);
        _claim(other, 1 * USD, 200, 0, _noQuests());
        _claim(other, 1 * USD, 201, 0, _noQuests());
        _claim(other, 2 * USD, 202, 0, _noQuests());

        assertEq(oneShot, 40);
        assertEq(core.profileOf(other).stars, oneShot, "splitting a $4 spend earns identical XP");
    }

    function test_secondPurchaseReusesSamePass() public {
        _claim(user, 1 * USD, 100, 0, _noQuests());
        uint256 tokenId = pass.tokenOfOwner(user);
        _claim(user, 1 * USD, 101, 0, _noQuests());
        assertEq(pass.tokenOfOwner(user), tokenId, "no second mint");
        assertEq(core.profileOf(user).purchaseCount, 2);
    }

    // ------------------------------------------------------------ ERC-20 specifics

    function test_revertsWhenTxIsNotToTheToken() public {
        // A plain native transfer straight to the merchant is no longer a valid payment.
        EvmV1Decoder.LogEntryTuple[] memory none = new EvmV1Decoder.LogEntryTuple[](0);
        bytes memory txb = TxFixture.build(user, payout, false, 1 ether, 1, hex"", none);
        vm.prank(user);
        vm.expectRevert(abi.encodeWithSelector(VouchCore.NotAPaymentToTheToken.selector, payout));
        core.recordPurchase(100, txb, mp, cp, 0, _noQuests());
    }

    function test_revertsWhenTransferPaysAnUnregisteredAddress() public {
        bytes memory txb = TxFixture.usdcPayment(token, user, address(0x9999), 5 * USD);
        vm.prank(user);
        vm.expectRevert(VouchCore.NoMatchingTransfer.selector);
        core.recordPurchase(100, txb, mp, cp, 0, _noQuests());
    }

    /// A forged Transfer log from some other contract must not be credited as a USDC payment.
    function test_ignoresTransferLogFromAnotherToken() public {
        EvmV1Decoder.LogEntryTuple[] memory logs = new EvmV1Decoder.LogEntryTuple[](1);
        logs[0] = TxFixture.transferLog(address(0xDEAD), user, payout, 1000 * USD);
        bytes memory txb = TxFixture.usdcPaymentWithLogs(token, user, logs);
        vm.prank(user);
        vm.expectRevert(VouchCore.NoMatchingTransfer.selector);
        core.recordPurchase(100, txb, mp, cp, 0, _noQuests());
    }

    /// A transfer someone else sent, riding along in the same transaction, must not count.
    function test_ignoresTransferSentByAnotherPayer() public {
        EvmV1Decoder.LogEntryTuple[] memory logs = new EvmV1Decoder.LogEntryTuple[](1);
        logs[0] = TxFixture.transferLog(token, address(0xBAD), payout, 999 * USD);
        bytes memory txb = TxFixture.usdcPaymentWithLogs(token, user, logs);
        vm.prank(user);
        vm.expectRevert(VouchCore.NoMatchingTransfer.selector);
        core.recordPurchase(100, txb, mp, cp, 0, _noQuests());
    }

    /// Fee-split style transaction: only the leg paying the registered merchant is credited.
    function test_picksTheMerchantLegOutOfMultipleTransfers() public {
        EvmV1Decoder.LogEntryTuple[] memory logs = new EvmV1Decoder.LogEntryTuple[](3);
        logs[0] = TxFixture.transferLog(token, user, address(0x1111), 2 * USD); // unrelated payee
        logs[1] = TxFixture.transferLog(token, user, payout, 7 * USD);          // the merchant
        logs[2] = TxFixture.transferLog(token, user, address(0x2222), 1 * USD); // fee
        bytes memory txb = TxFixture.usdcPaymentWithLogs(token, user, logs);

        verifier.setTxIndex(0);
        vm.prank(user);
        core.recordPurchase(100, txb, mp, cp, 0, _noQuests());

        assertEq(core.profileOf(user).verifiedSpend, 7 * USD, "only the merchant leg counts");
    }

    function test_revertsOnZeroValueTransfer() public {
        bytes memory txb = TxFixture.usdcPayment(token, user, payout, 0);
        vm.prank(user);
        vm.expectRevert(VouchCore.ZeroValuePurchase.selector);
        core.recordPurchase(100, txb, mp, cp, 0, _noQuests());
    }

    function test_revertsWhenPaymentTokenUnset() public {
        vm.prank(admin);
        core.setPaymentToken(address(0), 6);
        bytes memory txb = TxFixture.usdcPayment(token, user, payout, 1 * USD);
        vm.prank(user);
        vm.expectRevert(VouchCore.PaymentTokenNotSet.selector);
        core.recordPurchase(100, txb, mp, cp, 0, _noQuests());
    }

    // ------------------------------------------------------------ replay protection

    function test_sameSourceTxCannotBeClaimedTwice() public {
        _claim(user, 5 * USD, 100, 3, _noQuests());
        bytes32 pid = core.purchaseIdFor(100, 3);

        verifier.setTxIndex(3);
        bytes memory txb = TxFixture.usdcPayment(token, user, payout, 5 * USD);
        vm.prank(user);
        vm.expectRevert(abi.encodeWithSelector(VouchCore.PurchaseAlreadyClaimed.selector, pid));
        core.recordPurchase(100, txb, mp, cp, 0, _noQuests());

        assertEq(core.profileOf(user).purchaseCount, 1, "replay earned nothing");
    }

    function test_sameHeightDifferentTxIndexIsDistinct() public {
        _claim(user, 1 * USD, 100, 3, _noQuests());
        _claim(user, 1 * USD, 100, 4, _noQuests());
        assertEq(core.profileOf(user).purchaseCount, 2);
    }

    // ------------------------------------------------------------ trust boundary

    function test_revertsWhenReceiptStatusFailed() public {
        EvmV1Decoder.LogEntryTuple[] memory logs = new EvmV1Decoder.LogEntryTuple[](1);
        logs[0] = TxFixture.transferLog(token, user, payout, 5 * USD);
        bytes memory txb = TxFixture.build(user, token, false, 0, 0, hex"", logs);
        vm.prank(user);
        vm.expectRevert(VouchCore.SourceTxFailed.selector);
        core.recordPurchase(100, txb, mp, cp, 0, _noQuests());
    }

    function test_revertsWhenProofNotVerified() public {
        verifier.setResult(false);
        bytes memory txb = TxFixture.usdcPayment(token, user, payout, 5 * USD);
        vm.prank(user);
        vm.expectRevert(VouchCore.NotVerified.selector);
        core.recordPurchase(100, txb, mp, cp, 0, _noQuests());
    }

    function test_revertsWhenCallerIsNotThePayer() public {
        address thief = address(0xBAD);
        bytes memory txb = TxFixture.usdcPayment(token, user, payout, 5 * USD);
        vm.prank(thief);
        vm.expectRevert(abi.encodeWithSelector(VouchCore.PayerMismatch.selector, user, thief));
        core.recordPurchase(100, txb, mp, cp, 0, _noQuests());
    }

    function test_revertsForInactiveMerchant() public {
        vm.prank(merchant);
        registry.setActive(commerceId, false);
        bytes memory txb = TxFixture.usdcPayment(token, user, payout, 5 * USD);
        vm.prank(user);
        vm.expectRevert(abi.encodeWithSelector(VouchCore.MerchantInactive.selector, commerceId));
        core.recordPurchase(100, txb, mp, cp, 0, _noQuests());
    }

    // ------------------------------------------------------------ registry / soulbound

    function test_payoutAddressCannotBackTwoMerchants() public {
        vm.prank(address(0x1111));
        vm.expectRevert(
            abi.encodeWithSelector(CommerceRegistry.PayoutAlreadyRegistered.selector, payout, commerceId)
        );
        registry.register("Impostor", "", payout);
    }

    function test_passCannotBeTransferred() public {
        _claim(user, 1 * USD, 100, 0, _noQuests());
        uint256 tokenId = pass.tokenOfOwner(user);
        vm.prank(user);
        vm.expectRevert(BenefitPass.Soulbound.selector);
        pass.transferFrom(user, address(0x1234), tokenId);
    }

    function test_passApprovalsRejected() public {
        _claim(user, 1 * USD, 100, 0, _noQuests());
        vm.prank(user);
        vm.expectRevert(BenefitPass.Soulbound.selector);
        pass.setApprovalForAll(address(0x1234), true);
    }

    function test_onlyCoreCanMintPass() public {
        vm.expectRevert(BenefitPass.NotMinter.selector);
        pass.mint(user);
    }

    function test_tokenUriRendersLiveLevel() public {
        _claim(user, 1 * USD, 100, 0, _noQuests());
        assertGt(bytes(pass.tokenURI(pass.tokenOfOwner(user))).length, 100);
    }

    // ------------------------------------------------------------ streak

    function test_streakIncrementsDailyAndResetsAfterGap() public {
        vm.prank(user);
        (uint32 s1, uint256 xp1) = core.checkIn();
        assertEq(s1, 1);
        assertEq(xp1, 5);

        vm.prank(user);
        vm.expectRevert(VouchCore.AlreadyCheckedInToday.selector);
        core.checkIn();

        vm.warp(block.timestamp + 1 days);
        vm.prank(user);
        (uint32 s2,) = core.checkIn();
        assertEq(s2, 2);

        vm.warp(block.timestamp + 1 days);
        vm.prank(user);
        (uint32 s3, uint256 xp3) = core.checkIn();
        assertEq(s3, 3);
        assertEq(xp3, 10, "day 3+ pays 10");

        vm.warp(block.timestamp + 3 days);
        vm.prank(user);
        (uint32 s4,) = core.checkIn();
        assertEq(s4, 1, "streak reset after a missed day");
    }

    function test_seventhDayPaysBonus() public {
        for (uint256 i = 0; i < 6; i++) {
            vm.prank(user);
            core.checkIn();
            vm.warp(block.timestamp + 1 days);
        }
        vm.prank(user);
        (uint32 streak, uint256 xp) = core.checkIn();
        assertEq(streak, 7);
        assertEq(xp, 60, "10 + 50 bonus");
    }

    // ------------------------------------------------------------ quests + cashback

    function _makeQuest(uint32 minPurchases, uint256 cashback, uint32 minLevel) internal returns (uint256 qid) {
        return _makeItemQuest(minPurchases, cashback, minLevel, 0);
    }

    function _makeItemQuest(uint32 minPurchases, uint256 cashback, uint32 minLevel, uint256 itemId)
        internal
        returns (uint256 qid)
    {
        vm.prank(merchant);
        qid = quests.createQuest(
            QuestManager.NewQuest({
                commerceId: commerceId,
                title: "Test quest",
                description: "A quest used by the suite.",
                itemId: itemId,
                minPurchases: minPurchases,
                minSpendWei: 0,
                cashback: cashback,
                minLevel: minLevel,
                startsAt: 0,
                endsAt: 0,
                maxClaims: 0
            })
        );
    }

    /// A listed item: name, exact price, finite stock.
    function _listItem(uint256 price, uint32 stock) internal returns (uint256 itemId) {
        vm.prank(merchant);
        itemId = catalog.listItem(commerceId, "Flat White", "House espresso and milk.", price, stock);
    }

    function test_questCompletesAndPaysCashback() public {
        uint256 qid = _makeQuest(2, 1 ether, 1);
        vm.deal(merchant, 10 ether);
        vm.prank(merchant);
        vault.fund{value: 5 ether}(commerceId);

        uint256[] memory qids = new uint256[](1);
        qids[0] = qid;

        _claim(user, 1 * USD, 100, 0, qids);
        assertFalse(quests.completedBy(user, qid), "1 of 2 purchases");
        assertEq(vault.claimable(user), 0);

        _claim(user, 1 * USD, 101, 0, qids);
        assertTrue(quests.completedBy(user, qid));
        assertEq(vault.claimable(user), 1 ether, "cashback credited");
    }

    function test_questCannotBeCompletedTwice() public {
        uint256 qid = _makeQuest(1, 0, 1);
        uint256[] memory qids = new uint256[](1);
        qids[0] = qid;

        _claim(user, 1 * USD, 100, 0, qids);
        uint256 starsAfterFirst = core.profileOf(user).stars;
        _claim(user, 1 * USD, 101, 0, qids);

        assertEq(core.profileOf(user).questsCompleted, 1);
        assertEq(core.profileOf(user).stars, starsAfterFirst + 10, "second $1 earns spend XP only");
    }

    /// A merchant has no XP lever at all: completing a quest moves cashback, never progression.
    function test_completingAQuestGrantsNoXp() public {
        uint256 qid = _makeQuest(1, 1 ether, 1);
        vm.deal(merchant, 10 ether);
        vm.prank(merchant);
        vault.fund{value: 5 ether}(commerceId);

        uint256[] memory qids = new uint256[](1);
        qids[0] = qid;
        _claim(user, 2 * USD, 100, 0, qids);

        assertTrue(quests.completedBy(user, qid));
        assertEq(vault.claimable(user), 1 ether, "cashback paid");
        assertEq(core.profileOf(user).stars, 20, "$2 x 10 XP and nothing more");
    }

    function test_questRequiresATitle() public {
        vm.prank(merchant);
        vm.expectRevert(QuestManager.MissingTitle.selector);
        quests.createQuest(
            QuestManager.NewQuest({
                commerceId: commerceId,
                title: "",
                description: "",
                itemId: 0,
                minPurchases: 1,
                minSpendWei: 0,
                cashback: 0,
                minLevel: 1,
                startsAt: 0,
                endsAt: 0,
                maxClaims: 0
            })
        );
    }

    // ------------------------------------------------------ app cashback

    /// The whole promise: nothing is released until Attestcoin has proven the Sepolia payment.
    function test_noCashbackUntilAttestcoinVerifies() public {
        uint256 qid = _makeQuest(1, 1 ether, 1);
        vm.deal(merchant, 10 ether);
        vm.prank(merchant);
        vault.fund{value: 5 ether}(commerceId);
        uint256[] memory qids = new uint256[](1);
        qids[0] = qid;

        // Get the buyer to level 2, so the app rate is live and there is something to lose.
        _claim(user, 6 * USD, 100, 0, _noQuests());
        assertEq(core.profileOf(user).level, 2);

        uint256 vaultBefore = vault.claimable(user);
        uint256 appBefore = appCash.claimable(user);
        uint256 receiptsBefore = core.receiptsOf(user).length;

        // Now the same payment, but the precompile says the block was never attested.
        verifier.setResult(false);
        verifier.setTxIndex(1);
        bytes memory txb = TxFixture.usdcPayment(token, user, payout, 50 * USD);
        vm.prank(user);
        vm.expectRevert(VouchCore.NotVerified.selector);
        core.recordPurchase(101, txb, mp, cp, 0, qids);

        assertEq(vault.claimable(user), vaultBefore, "no merchant cashback from an unproven payment");
        assertEq(appCash.claimable(user), appBefore, "no app cashback either");
        assertEq(core.receiptsOf(user).length, receiptsBefore, "and no receipt");
        assertFalse(quests.completedBy(user, qid), "the quest did not advance");

        // Once it verifies, the very same payment pays out.
        verifier.setResult(true);
        vm.prank(user);
        core.recordPurchase(101, txb, mp, cp, 0, qids);

        assertEq(vault.claimable(user), vaultBefore + 1 ether, "merchant cashback released");
        assertGt(appCash.claimable(user), appBefore, "app cashback released");
        assertEq(core.receiptsOf(user).length, receiptsBefore + 1);
    }

    /// A payment that was included but reverted must not pay either.
    function test_noCashbackFromARevertedPayment() public {
        _claim(user, 6 * USD, 100, 0, _noQuests()); // reach level 2
        uint256 appBefore = appCash.claimable(user);

        verifier.setTxIndex(1);
        EvmV1Decoder.LogEntryTuple[] memory logs = new EvmV1Decoder.LogEntryTuple[](1);
        logs[0] = TxFixture.transferLog(token, user, payout, 50 * USD);
        bytes memory failed = TxFixture.build(user, token, false, 0, 0, hex"", logs);

        vm.prank(user);
        vm.expectRevert(VouchCore.SourceTxFailed.selector);
        core.recordPurchase(101, failed, mp, cp, 0, _noQuests());

        assertEq(appCash.claimable(user), appBefore, "inclusion is not success");
    }

    function test_appCashbackPaysAPercentageOfEveryProvenPurchase() public {
        // Level 1 earns nothing, but the $10 spend lifts the profile to level 2 (100 XP).
        _claim(user, 10 * USD, 100, 0, _noQuests());
        assertEq(appCash.claimable(user), 0, "level 1 is outside the ladder");
        assertEq(core.profileOf(user).level, 2);

        // Now at level 2: 2% of $10 = $0.20 = 0.4 CTC.
        _claim(user, 10 * USD, 101, 0, _noQuests());
        assertEq(appCash.claimable(user), 0.4 ether);
        assertEq(_receipt(2).appCashbackEarned, 0.4 ether, "the receipt records it separately");
    }

    /// The rate is set by the level held *before* the purchase, so one purchase cannot both raise
    /// the level and be paid at the new rate.
    function test_appCashbackUsesTheLevelHeldBeforeThePurchase() public {
        _claim(user, 10 * USD, 100, 0, _noQuests()); // level 1 -> 2, pays nothing
        assertEq(appCash.claimable(user), 0);
        assertEq(core.profileOf(user).level, 2);
    }

    /// Merchant cashback and app cashback are separate pots and must not be confused.
    function test_merchantAndAppCashbackAreCreditedSeparately() public {
        uint256 qid = _makeQuest(1, 1 ether, 1);
        vm.deal(merchant, 10 ether);
        vm.prank(merchant);
        vault.fund{value: 5 ether}(commerceId);

        uint256[] memory qids = new uint256[](1);
        qids[0] = qid;

        _claim(user, 6 * USD, 100, 0, _noQuests()); // 60 XP -> level 2
        _claim(user, 5 * USD, 101, 0, qids);

        assertEq(vault.claimable(user), 1 ether, "merchant pays the quest reward");
        assertEq(appCash.claimable(user), 0.2 ether, "protocol pays 2% of $5 = 0.2 CTC");
        assertEq(core.profileOf(user).totalCashback, 1.2 ether, "the profile totals both");
    }

    function test_purchaseStillSucceedsWhenTheCashbackTreasuryIsEmpty() public {
        vm.prank(admin);
        appCash.reclaim(200 ether);

        _claim(user, 10 * USD, 100, 0, _noQuests());
        _claim(user, 10 * USD, 101, 0, _noQuests());

        assertEq(appCash.claimable(user), 0);
        assertEq(core.profileOf(user).purchaseCount, 2, "the receipts still stand");
        assertEq(core.profileOf(user).stars, 200);
    }

    // ------------------------------------------------------------ catalog

    function test_provenPurchaseConsumesListedStock() public {
        uint256 itemId = _listItem(2 * USD, 3);

        _claimItem(user, 2 * USD, 100, 0, itemId, _noQuests());

        Catalog.Item memory it = catalog.getItem(itemId);
        assertEq(it.sold, 1, "one unit sold");
        assertEq(catalog.remaining(itemId), 2);
        assertEq(_receipt(1).itemId, itemId, "receipt names the item");
    }

    function test_stockCannotGoBelowZero() public {
        uint256 itemId = _listItem(1 * USD, 1);

        _claimItem(user, 1 * USD, 100, 0, itemId, _noQuests());
        _claimItem(user, 1 * USD, 101, 0, itemId, _noQuests());

        assertEq(catalog.getItem(itemId).sold, 1, "second sale finds it sold out");
        assertEq(catalog.remaining(itemId), 0);
        // The sold-out item must not have cost the buyer their receipt or XP.
        assertEq(core.profileOf(user).purchaseCount, 2);
        assertEq(core.profileOf(user).stars, 20);
    }

    function test_underpayingDoesNotConsumeAUnit() public {
        uint256 itemId = _listItem(5 * USD, 4);

        _claimItem(user, 1 * USD, 100, 0, itemId, _noQuests());

        assertEq(catalog.getItem(itemId).sold, 0, "$1 does not buy a $5 item");
        assertEq(core.profileOf(user).purchaseCount, 1, "the payment still counts as spend");
    }

    function test_itemQuestOnlyAdvancesOnThatItem() public {
        uint256 flatWhite = _listItem(2 * USD, 10);
        vm.prank(merchant);
        uint256 croissant = catalog.listItem(commerceId, "Croissant", "Almond.", 2 * USD, 10);

        uint256 qid = _makeItemQuest(1, 0, 1, flatWhite);
        uint256[] memory qids = new uint256[](1);
        qids[0] = qid;

        _claimItem(user, 2 * USD, 100, 0, croissant, qids);
        assertFalse(quests.completedBy(user, qid), "wrong item does not advance the quest");

        _claimItem(user, 2 * USD, 101, 0, flatWhite, qids);
        assertTrue(quests.completedBy(user, qid), "the named item does");
    }

    function test_unknownItemIdDoesNotBrickThePurchase() public {
        _claimItem(user, 2 * USD, 100, 0, 999, _noQuests());
        assertEq(core.profileOf(user).purchaseCount, 1);
    }

    function test_onlyCoreCanRecordSale() public {
        uint256 itemId = _listItem(1 * USD, 5);
        vm.expectRevert(Catalog.NotCore.selector);
        catalog.recordSale(commerceId, itemId, user, 1 * USD);
    }

    function test_onlyMerchantCanListAndRestock() public {
        vm.expectRevert(Catalog.NotCommerceOwner.selector);
        catalog.listItem(commerceId, "Sneaky", "", 1 * USD, 1);

        uint256 itemId = _listItem(1 * USD, 1);
        vm.expectRevert(Catalog.NotCommerceOwner.selector);
        catalog.restock(itemId, 5);

        vm.prank(merchant);
        catalog.restock(itemId, 5);
        assertEq(catalog.remaining(itemId), 6);
    }

    function test_questBelowMinLevelDoesNotPay() public {
        uint256 qid = _makeQuest(1, 0, 5);
        uint256[] memory qids = new uint256[](1);
        qids[0] = qid;

        _claim(user, 1 * USD, 100, 0, qids);
        assertFalse(quests.completedBy(user, qid), "level gate holds");
    }

    function test_unknownQuestIdDoesNotBrickThePurchase() public {
        uint256[] memory qids = new uint256[](1);
        qids[0] = 999999;
        _claim(user, 1 * USD, 100, 0, qids);
        assertEq(core.profileOf(user).purchaseCount, 1, "purchase still recorded");
    }

    function test_cashbackRevertsWhenCampaignUnderfunded() public {
        uint256 qid = _makeQuest(1, 1 ether, 1);
        uint256[] memory qids = new uint256[](1);
        qids[0] = qid;

        verifier.setTxIndex(0);
        bytes memory txb = TxFixture.usdcPayment(token, user, payout, 1 * USD);
        vm.prank(user);
        vm.expectRevert(abi.encodeWithSelector(RewardVault.CampaignUnderfunded.selector, commerceId, 1 ether, 0));
        core.recordPurchase(100, txb, mp, cp, 0, qids);
    }

    function test_userWithdrawsCashback() public {
        uint256 qid = _makeQuest(1, 1 ether, 1);
        vm.deal(merchant, 10 ether);
        vm.prank(merchant);
        vault.fund{value: 2 ether}(commerceId);

        uint256[] memory qids = new uint256[](1);
        qids[0] = qid;
        _claim(user, 1 * USD, 100, 0, qids);

        uint256 before = user.balance;
        vm.prank(user);
        vault.withdraw();
        assertEq(user.balance - before, 1 ether);
    }

    function test_onlyCoreCanCreditVault() public {
        vm.expectRevert(RewardVault.NotCore.selector);
        vault.credit(commerceId, user, 1 ether);
    }

    // ------------------------------------------------------------ milestones

    function _makeMilestone(uint256 target, uint256 rewardPerUser, uint256 budget)
        internal
        returns (uint256 id)
    {
        vm.deal(merchant, budget + 1 ether);
        vm.prank(merchant);
        id = milestones.createCampaign{value: budget}(
            commerceId, "Test campaign", "A campaign used by the suite.", target, 0, rewardPerUser, 0, 0
        );
    }

    function test_milestoneUnlocksOnlyWhenTargetReached() public {
        uint256 id = _makeMilestone(3, 2 ether, 10 ether);

        _claim(user, 1 * USD, 100, 0, _noQuests());
        vm.prank(user);
        vm.expectRevert(MilestoneManager.MilestoneNotReached.selector);
        milestones.claim(id);

        address u2 = address(0xE2);
        address u3 = address(0xE3);
        verifier.setTxIndex(0);
        bytes memory t2 = TxFixture.usdcPayment(token, u2, payout, 1 * USD);
        vm.prank(u2);
        core.recordPurchase(101, t2, mp, cp, 0, _noQuests());

        bytes memory t3 = TxFixture.usdcPayment(token, u3, payout, 1 * USD);
        vm.prank(u3);
        core.recordPurchase(102, t3, mp, cp, 0, _noQuests());

        // Target of 3 units now met -- every participant may claim.
        assertEq(milestones.getCampaign(id).unitsSold, 3);

        vm.prank(user);
        assertEq(milestones.claim(id), 2 ether);
        assertEq(milestones.claimable(user), 2 ether);
    }

    function test_milestoneBudgetHardCapsPayouts() public {
        // Budget only covers two claimants even though three qualify.
        uint256 id = _makeMilestone(3, 2 ether, 4 ether);

        address u2 = address(0xE2);
        address u3 = address(0xE3);
        verifier.setTxIndex(0);
        _claim(user, 1 * USD, 100, 0, _noQuests());
        bytes memory t2 = TxFixture.usdcPayment(token, u2, payout, 1 * USD);
        vm.prank(u2);
        core.recordPurchase(101, t2, mp, cp, 0, _noQuests());
        bytes memory t3 = TxFixture.usdcPayment(token, u3, payout, 1 * USD);
        vm.prank(u3);
        core.recordPurchase(102, t3, mp, cp, 0, _noQuests());

        vm.prank(user);
        milestones.claim(id);
        vm.prank(u2);
        milestones.claim(id);

        vm.prank(u3);
        vm.expectRevert(MilestoneManager.PoolExhausted.selector);
        milestones.claim(id);

        assertEq(milestones.getCampaign(id).budget, 0, "merchant never overspends");
    }

    function test_milestoneCannotBeClaimedTwice() public {
        uint256 id = _makeMilestone(1, 1 ether, 5 ether);
        _claim(user, 1 * USD, 100, 0, _noQuests());

        vm.prank(user);
        milestones.claim(id);
        vm.prank(user);
        vm.expectRevert(MilestoneManager.AlreadyClaimed.selector);
        milestones.claim(id);
    }

    function test_nonParticipantCannotClaimMilestone() public {
        uint256 id = _makeMilestone(1, 1 ether, 5 ether);
        _claim(user, 1 * USD, 100, 0, _noQuests());

        vm.prank(address(0xFEE1));
        vm.expectRevert(MilestoneManager.NotAParticipant.selector);
        milestones.claim(id);
    }

    function test_milestoneMinSpendFiltersSmallPurchases() public {
        vm.deal(merchant, 10 ether);
        vm.prank(merchant);
        uint256 id = milestones.createCampaign{value: 5 ether}(
            commerceId, "Min spend campaign", "", 1, 5 * USD, 1 ether, 0, 0
        );

        _claim(user, 1 * USD, 100, 0, _noQuests()); // below minSpend
        assertEq(milestones.getCampaign(id).unitsSold, 0, "cheap purchase does not count");

        _claim(user, 5 * USD, 101, 0, _noQuests());
        assertEq(milestones.getCampaign(id).unitsSold, 1);
    }

    function test_onlyCoreCanRecordMilestoneUnits() public {
        _makeMilestone(1, 1 ether, 5 ether);
        vm.expectRevert(MilestoneManager.NotCore.selector);
        milestones.recordUnit(commerceId, user, 1 * USD);
    }

    function test_merchantCannotReclaimWhileCampaignLive() public {
        uint256 id = _makeMilestone(5, 1 ether, 5 ether);
        vm.prank(merchant);
        vm.expectRevert(MilestoneManager.CampaignStillLive.selector);
        milestones.reclaim(id);
    }

    function test_merchantReclaimsAfterPausing() public {
        uint256 id = _makeMilestone(5, 1 ether, 5 ether);
        vm.startPrank(merchant);
        milestones.setActive(id, false);
        uint256 got = milestones.reclaim(id);
        vm.stopPrank();
        assertEq(got, 5 ether);
    }

    function test_milestoneWithdrawPaysOut() public {
        uint256 id = _makeMilestone(1, 1 ether, 5 ether);
        _claim(user, 1 * USD, 100, 0, _noQuests());
        vm.prank(user);
        milestones.claim(id);

        uint256 before = user.balance;
        vm.prank(user);
        milestones.withdraw();
        assertEq(user.balance - before, 1 ether);
    }

    // ------------------------------------------------------------ levels

    function test_levelProgression() public {
        assertEq(core.levelOf(user), 1);
        _claim(user, 4 * USD, 100, 0, _noQuests()); // 450
        assertEq(core.levelOf(user), 1);
        _claim(user, 1 * USD, 101, 0, _noQuests()); // +150 => 600
        assertEq(core.levelOf(user), 2);
        _claim(user, 10 * USD, 102, 0, _noQuests()); // +1050 => 1650
        assertEq(core.levelOf(user), 3);
    }

    function test_dailyStatsTracked() public {
        _claim(user, 2 * USD, 100, 0, _noQuests());
        _claim(user, 3 * USD, 101, 0, _noQuests());
        VouchCore.DailyStats memory d = core.todayStats(user);
        assertEq(d.purchases, 2);
        assertEq(d.spend, 5 * USD);
    }
}
