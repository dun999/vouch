// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Ownable} from "openzeppelin-contracts/access/Ownable.sol";
import {INativeQueryVerifier, NativeQueryVerifierLib} from "./vendor/INativeQueryVerifier.sol";
import {EvmV1Decoder} from "./vendor/EvmV1Decoder.sol";
import {
    ICommerceRegistry,
    IBenefitPass,
    IQuestManager,
    IRewardVault,
    IMilestoneManager,
    ICatalog,
    IAppCashback
} from "./interfaces/IVouch.sol";

/// @title VouchCore
/// @notice Turns an Attestcoin-proven Sepolia USDC payment into progression: receipt, stars, level,
///         quest completion, merchant-funded cashback and milestone participation.
///
/// @dev Stars are a protocol constant applied to verified spend ($1 = `starsPerDollar` stars).
///      Merchants fund cashback, never stars -- otherwise a storefront could mint levels for its
///      own customers and the pass would stop meaning "this person actually spent this much".
///
/// @dev Three properties of the block-prover precompile drive this design:
///      1. It proves *inclusion only* -- it does NOT check whether the transaction succeeded, so
///         we independently require `receiptStatus == 1`.
///      2. The decoded fields carry no transaction hash, so replay protection cannot key on a
///         caller-supplied hash (that would be forgeable). It keys on the canonical triple
///         (chainKey, height, txIndex), where txIndex comes from the precompile itself.
///      3. Payment is in USDC, an ERC-20. The transaction's `to` is the token contract and its
///         `value` is zero -- the real payee and amount live in the `Transfer` event log. So we
///         decode the receipt logs rather than trusting the top-level transfer fields.
contract VouchCore is Ownable {
    struct Profile {
        uint256 stars;
        uint256 verifiedSpend; // in token base units (USDC, 6dp)
        uint256 totalCashback;
        uint32 level;
        uint32 purchaseCount;
        uint32 questsCompleted;
        uint32 streak;
        uint64 lastCheckInDay;
    }

    struct Receipt {
        address user;
        address commercePayout;
        uint256 commerceId;
        uint256 itemId;        // catalog item bought, 0 if the payment named none
        uint256 amount;
        uint64 sourceHeight;
        uint64 sourceTxIndex;
        uint64 timestamp;
        uint256 starsEarned;
        uint256 cashbackEarned;    // merchant-funded, from a completed quest
        uint256 appCashbackEarned; // protocol-funded, from the level rate
        uint32 levelAfter;
    }

    struct DailyStats {
        uint32 purchases;
        uint256 spend;
    }

    /// @notice Maximum purchases per `recordPurchasesBatch` call. Matches the Attestcoin
    ///         `getBatchProof` limit so one prover call always feeds one claim call.
    uint256 public constant MAX_BATCH = 10;

    /// @dev keccak256("Transfer(address,address,uint256)")
    bytes32 internal constant TRANSFER_SIG = 0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef;

    INativeQueryVerifier public immutable VERIFIER;

    /// @notice Attestcoin chain key for the source chain. 1 == Ethereum Sepolia on CC3 testnet.
    uint64 public immutable CHAIN_KEY;

    ICommerceRegistry public immutable registry;
    IBenefitPass public immutable pass;
    IQuestManager public questManager;
    IRewardVault public rewardVault;
    IMilestoneManager public milestoneManager;
    ICatalog public catalog;
    IAppCashback public appCashback;

    /// @notice The Sepolia ERC-20 accepted as payment, and its decimals.
    address public paymentToken;
    uint8 public paymentDecimals;

    /// @notice Stars per whole dollar of verified spend. 10 => $1 = 10 stars.
    /// @dev This is the *only* source of purchase stars. There is no per-purchase bonus and no
    ///      merchant-supplied component, so a level is always a faithful readout of dollars spent.
    uint256 public starsPerDollar = 10;
    uint256 public starsPerPurchase = 0;

    /// @notice Cumulative stars needed for level 2, 3, ... Level 1 is the floor.
    uint256[] public levelThresholds;

    mapping(address => Profile) private _profiles;
    /// @notice keccak256(chainKey, height, txIndex) => used. Enforces "one source tx, once".
    mapping(bytes32 => bool) public usedPurchase;
    mapping(uint256 => Receipt) public receipts;
    mapping(address => uint256[]) private _receiptsOf;
    mapping(address => mapping(uint64 => DailyStats)) public dailyStats;

    uint256 public nextReceiptId = 1;

    event PurchaseVerified(
        uint256 indexed receiptId,
        address indexed user,
        uint256 indexed commerceId,
        uint256 amount,
        uint64 sourceHeight,
        uint64 sourceTxIndex,
        uint256 starsEarned,
        uint256 cashbackEarned,
        uint32 levelAfter
    );
    event QuestCompleted(address indexed user, uint256 indexed questId, uint256 cashback);
    event ItemPurchased(address indexed user, uint256 indexed commerceId, uint256 indexed itemId, uint256 amount);
    event AppCashbackEarned(address indexed user, uint32 level, uint256 amount);
    event LevelUp(address indexed user, uint32 fromLevel, uint32 toLevel);
    event CheckedIn(address indexed user, uint32 streak, uint256 starsEarned);
    event PaymentTokenSet(address token, uint8 decimals);
    event StarConfigUpdated(uint256 starsPerDollar, uint256 starsPerPurchase);
    event LevelThresholdsUpdated(uint256[] thresholds);

    error NotVerified();
    error SourceTxFailed();
    error PaymentTokenNotSet();
    error NotAPaymentToTheToken(address to);
    error NoMatchingTransfer();
    error PayerMismatch(address decodedFrom, address caller);
    error MerchantNotRegistered(address payout);
    error MerchantInactive(uint256 commerceId);
    error PurchaseAlreadyClaimed(bytes32 purchaseId);
    error ZeroValuePurchase();
    error AlreadyCheckedInToday();
    error BatchLengthMismatch();
    error BatchTooLarge(uint256 size, uint256 max);

    constructor(uint64 chainKey, address registry_, address pass_, address verifier_, address initialOwner)
        Ownable(initialOwner)
    {
        CHAIN_KEY = chainKey;
        VERIFIER = INativeQueryVerifier(verifier_ == address(0) ? NativeQueryVerifierLib.PRECOMPILE : verifier_);
        registry = ICommerceRegistry(registry_);
        pass = IBenefitPass(pass_);

        // $5, $15, $35, $70 of verified spend at 10 stars/$.
        levelThresholds = [uint256(50), 150, 350, 700];
    }

    // ---------------------------------------------------------------- purchases

    /// @notice Prove a Sepolia USDC payment and convert it into progression.
    /// @param height     Sepolia block height containing the payment.
    /// @param encodedTx  `txBytes` from the Attestcoin prover.
    /// @param itemId     Catalog item this payment bought, or 0 if it named none.
    /// @param questIds   Quests to attempt to complete with this purchase (may be empty).
    function recordPurchase(
        uint64 height,
        bytes calldata encodedTx,
        INativeQueryVerifier.MerkleProof calldata merkleProof,
        INativeQueryVerifier.ContinuityProof calldata continuityProof,
        uint256 itemId,
        uint256[] calldata questIds
    ) external returns (uint256 receiptId) {
        if (paymentToken == address(0)) revert PaymentTokenNotSet();

        // 1. Attestcoin proves the transaction was included in a finalized Sepolia block.
        if (!VERIFIER.verifyAndEmit(CHAIN_KEY, height, encodedTx, merkleProof, continuityProof)) {
            revert NotVerified();
        }

        // 2. Inclusion != success. The precompile does not check this; we must.
        EvmV1Decoder.ReceiptFields memory r = EvmV1Decoder.decodeReceiptFields(encodedTx);
        if (r.receiptStatus != 1) revert SourceTxFailed();

        EvmV1Decoder.CommonTxFields memory c = EvmV1Decoder.decodeCommonTxFields(encodedTx);

        // 3. The transaction must be a call into the accepted token contract.
        if (c.toIsNull || c.to != paymentToken) revert NotAPaymentToTheToken(c.to);

        // 4. Bind the Sepolia payer to the Creditcoin caller. Same EOA on both chains, so nobody
        //    can farm progression from a stranger's payment.
        if (c.from != msg.sender) revert PayerMismatch(c.from, msg.sender);

        // 5. Find the Transfer log that actually paid a registered merchant. This is the payment,
        //    not the transaction's `value` (which is zero for an ERC-20 transfer).
        (uint256 commerceId, address payout, uint256 amount) = _findMerchantTransfer(r, c.from);

        // 6. Replay protection on the canonical source-tx identity.
        uint64 txIndex = VERIFIER.calculateTxIndex(merkleProof);
        bytes32 purchaseId = keccak256(abi.encode(CHAIN_KEY, height, txIndex));
        if (usedPurchase[purchaseId]) revert PurchaseAlreadyClaimed(purchaseId);
        usedPurchase[purchaseId] = true;

        receiptId = _applyPurchase(
            Sale({user: c.from, payout: payout, commerceId: commerceId, itemId: itemId, amount: amount}),
            height,
            txIndex,
            questIds
        );
    }

    /// @notice Prove several Sepolia USDC payments in one call with a single shared continuity
    ///         proof (Attestcoin `getBatchProof`). Every entry goes through the same checks as
    ///         `recordPurchase`; the whole call reverts if any entry is invalid, so a batch is
    ///         all-or-nothing. Quests stay Sepolia-scoped: same `questIds` semantics per purchase.
    /// @dev Arrays must be parallel and non-empty, with at most `MAX_BATCH` entries.
    function recordPurchasesBatch(
        uint64[] calldata heights,
        bytes[] calldata encodedTxs,
        INativeQueryVerifier.MerkleProof[] calldata merkleProofs,
        INativeQueryVerifier.ContinuityProof calldata sharedContinuityProof,
        uint256[] calldata itemIds,
        uint256[][] calldata questIdsPerPurchase
    ) external returns (uint256[] memory receiptIds) {
        if (paymentToken == address(0)) revert PaymentTokenNotSet();

        uint256 n = heights.length;
        if (
            n == 0 || n != encodedTxs.length || n != merkleProofs.length || n != itemIds.length
                || n != questIdsPerPurchase.length
        ) revert BatchLengthMismatch();
        if (n > MAX_BATCH) revert BatchTooLarge(n, MAX_BATCH);

        // 1. One shared continuity proof covers every transaction in the batch.
        if (!VERIFIER.verifyAndEmit(CHAIN_KEY, heights, encodedTxs, merkleProofs, sharedContinuityProof)) {
            revert NotVerified();
        }

        // 2. Same per-payment validation as `recordPurchase`, applied entry by entry.
        receiptIds = new uint256[](n);
        for (uint256 i = 0; i < n; i++) {
            receiptIds[i] = _recordOnePurchase(
                encodedTxs[i],
                merkleProofs[i],
                heights[i],
                itemIds[i],
                questIdsPerPurchase[i]
            );
        }
    }

    /// @dev One entry of `recordPurchasesBatch`. Split out so the batch loop stays shallow.
    function _recordOnePurchase(
        bytes calldata encodedTx,
        INativeQueryVerifier.MerkleProof calldata merkleProof,
        uint64 height,
        uint256 itemId,
        uint256[] calldata questIds
    ) private returns (uint256) {
        EvmV1Decoder.ReceiptFields memory r = EvmV1Decoder.decodeReceiptFields(encodedTx);
        if (r.receiptStatus != 1) revert SourceTxFailed();

        EvmV1Decoder.CommonTxFields memory c = EvmV1Decoder.decodeCommonTxFields(encodedTx);
        if (c.toIsNull || c.to != paymentToken) revert NotAPaymentToTheToken(c.to);
        if (c.from != msg.sender) revert PayerMismatch(c.from, msg.sender);

        (uint256 commerceId, address payout, uint256 amount) = _findMerchantTransfer(r, c.from);

        uint64 txIndex = VERIFIER.calculateTxIndex(merkleProof);
        bytes32 purchaseId = keccak256(abi.encode(CHAIN_KEY, height, txIndex));
        if (usedPurchase[purchaseId]) revert PurchaseAlreadyClaimed(purchaseId);
        usedPurchase[purchaseId] = true;

        return _applyPurchase(
            Sale({user: c.from, payout: payout, commerceId: commerceId, itemId: itemId, amount: amount}),
            height,
            txIndex,
            questIds
        );
    }

    /// @dev Grouped so `_applyPurchase` keeps a shallow stack.
    struct Sale {
        address user;
        address payout;
        uint256 commerceId;
        uint256 itemId;
        uint256 amount;
    }

    /// @dev Scans the proven receipt for an ERC-20 Transfer emitted by the accepted token, sent by
    ///      the payer, to a registered active merchant. Only such a log counts as a purchase.
    function _findMerchantTransfer(EvmV1Decoder.ReceiptFields memory r, address payer)
        private
        view
        returns (uint256 commerceId, address payout, uint256 amount)
    {
        EvmV1Decoder.LogEntry[] memory logs = EvmV1Decoder.getLogsByEventSignature(r, TRANSFER_SIG);
        address token = paymentToken;

        for (uint256 i = 0; i < logs.length; i++) {
            EvmV1Decoder.LogEntry memory log = logs[i];
            // Transfer(address indexed from, address indexed to, uint256 value)
            if (log.address_ != token || log.topics.length < 3) continue;
            if (address(uint160(uint256(log.topics[1]))) != payer) continue;

            address to = address(uint160(uint256(log.topics[2])));
            uint256 id = registry.commerceIdByPayout(to);
            if (id == 0) continue;
            if (!registry.isActive(id)) revert MerchantInactive(id);

            uint256 v = abi.decode(log.data, (uint256));
            if (v == 0) revert ZeroValuePurchase();
            return (id, to, v);
        }
        revert NoMatchingTransfer();
    }

    function _applyPurchase(Sale memory s, uint64 height, uint64 txIndex, uint256[] calldata questIds)
        private
        returns (uint256 receiptId)
    {
        address user = s.user;
        uint256 commerceId = s.commerceId;
        uint256 amount = s.amount;

        Profile storage p = _profiles[user];
        uint32 levelBefore = p.level == 0 ? 1 : p.level;

        if (pass.tokenOfOwner(user) == 0) pass.mint(user);

        // $1 = starsPerDollar stars, scaled by the token's decimals. Spend is the whole formula.
        uint256 starsEarned = starsPerPurchase + (amount * starsPerDollar) / (10 ** paymentDecimals);

        p.verifiedSpend += amount;
        p.purchaseCount += 1;

        DailyStats storage today = dailyStats[user][_today()];
        today.purchases += 1;
        today.spend += amount;

        // Consume a unit of the merchant's listed stock. A stale or sold-out item must never brick
        // the claim, so the catalog reports failure rather than reverting.
        if (s.itemId != 0 && address(catalog) != address(0)) {
            if (catalog.recordSale(commerceId, s.itemId, user, amount)) {
                emit ItemPurchased(user, commerceId, s.itemId, amount);
            }
        }

        // Quests are evaluated against the level held *before* this purchase's XP lands, so a
        // single purchase cannot both raise the level and claim the reward it just unlocked.
        // A completed quest pays cashback only -- it never touches `starsEarned`.
        uint256 cashbackEarned;
        for (uint256 i = 0; i < questIds.length; i++) {
            if (address(questManager) == address(0)) break;
            (bool completed, uint256 cashback) =
                questManager.tryComplete(user, questIds[i], commerceId, s.itemId, amount, levelBefore);
            if (!completed) continue;

            p.questsCompleted += 1;
            if (cashback > 0 && address(rewardVault) != address(0)) {
                rewardVault.credit(commerceId, user, cashback);
                cashbackEarned += cashback;
            }
            emit QuestCompleted(user, questIds[i], cashback);
        }

        // Milestone campaigns count verified units and enrol the buyer. Payout happens later, only
        // once the merchant's target is actually reached.
        if (address(milestoneManager) != address(0)) {
            milestoneManager.recordUnit(commerceId, user, amount);
        }

        // Protocol-funded cashback: a percentage of spend set by the level held before this
        // purchase. Never reverts, so a stale price feed cannot cost anyone their receipt.
        uint256 appEarned;
        if (address(appCashback) != address(0)) {
            appEarned = appCashback.credit(user, levelBefore, amount);
            if (appEarned > 0) emit AppCashbackEarned(user, levelBefore, appEarned);
        }

        p.stars += starsEarned;
        p.totalCashback += cashbackEarned + appEarned;
        uint32 levelAfter = _refreshLevel(user, p);

        receiptId = nextReceiptId++;
        receipts[receiptId] = Receipt({
            user: user,
            commercePayout: s.payout,
            commerceId: commerceId,
            itemId: s.itemId,
            amount: amount,
            sourceHeight: height,
            sourceTxIndex: txIndex,
            timestamp: uint64(block.timestamp),
            starsEarned: starsEarned,
            cashbackEarned: cashbackEarned,
            appCashbackEarned: appEarned,
            levelAfter: levelAfter
        });
        _receiptsOf[user].push(receiptId);

        emit PurchaseVerified(
            receiptId, user, commerceId, amount, height, txIndex, starsEarned, cashbackEarned, levelAfter
        );
    }

    // ---------------------------------------------------------------- streak

    /// @notice Once per UTC day. +5 stars, +5, then +10 from day 3, with a day-7 bonus.
    function checkIn() external returns (uint32 streak, uint256 starsEarned) {
        Profile storage p = _profiles[msg.sender];
        uint64 today = _today();
        if (p.lastCheckInDay == today) revert AlreadyCheckedInToday();

        p.streak = (p.lastCheckInDay != 0 && p.lastCheckInDay == today - 1) ? p.streak + 1 : 1;
        p.lastCheckInDay = today;

        streak = p.streak;
        starsEarned = streak <= 2 ? 5 : 10;
        if (streak % 7 == 0) starsEarned += 50;

        p.stars += starsEarned;
        _refreshLevel(msg.sender, p);

        emit CheckedIn(msg.sender, streak, starsEarned);
    }

    // ---------------------------------------------------------------- levels

    function _refreshLevel(address user, Profile storage p) private returns (uint32 newLevel) {
        uint32 current = p.level == 0 ? 1 : p.level;
        newLevel = 1;
        for (uint256 i = 0; i < levelThresholds.length; i++) {
            if (p.stars >= levelThresholds[i]) newLevel = uint32(i + 2);
            else break;
        }
        p.level = newLevel;
        if (newLevel > current) emit LevelUp(user, current, newLevel);
    }

    function _today() private view returns (uint64) {
        return uint64(block.timestamp / 1 days);
    }

    // ---------------------------------------------------------------- views

    function profileOf(address user) external view returns (Profile memory p) {
        p = _profiles[user];
        if (p.level == 0) p.level = 1;
    }

    function levelOf(address user) external view returns (uint32) {
        uint32 l = _profiles[user].level;
        return l == 0 ? 1 : l;
    }

    function starsOf(address user) external view returns (uint256) {
        return _profiles[user].stars;
    }

    function receiptsOf(address user) external view returns (uint256[] memory) {
        return _receiptsOf[user];
    }

    /// @notice The struct form. Preferred over the `receipts` mapping getter, whose positional
    ///         tuple silently reshuffles whenever a field is added.
    function getReceipt(uint256 receiptId) external view returns (Receipt memory) {
        return receipts[receiptId];
    }

    function todayStats(address user) external view returns (DailyStats memory) {
        return dailyStats[user][_today()];
    }

    function getLevelThresholds() external view returns (uint256[] memory) {
        return levelThresholds;
    }

    function purchaseIdFor(uint64 height, uint64 txIndex) external view returns (bytes32) {
        return keccak256(abi.encode(CHAIN_KEY, height, txIndex));
    }

    // ---------------------------------------------------------------- admin

    function setPaymentToken(address token, uint8 decimals_) external onlyOwner {
        paymentToken = token;
        paymentDecimals = decimals_;
        emit PaymentTokenSet(token, decimals_);
    }

    function setQuestManager(address q) external onlyOwner {
        questManager = IQuestManager(q);
    }

    function setRewardVault(address v) external onlyOwner {
        rewardVault = IRewardVault(v);
    }

    function setMilestoneManager(address m) external onlyOwner {
        milestoneManager = IMilestoneManager(m);
    }

    function setCatalog(address c) external onlyOwner {
        catalog = ICatalog(c);
    }

    function setAppCashback(address a) external onlyOwner {
        appCashback = IAppCashback(a);
    }

    /// @dev Protocol-level, owner-only. Merchants have no equivalent lever.
    function setStarConfig(uint256 perDollar, uint256 perPurchase) external onlyOwner {
        starsPerDollar = perDollar;
        starsPerPurchase = perPurchase;
        emit StarConfigUpdated(perDollar, perPurchase);
    }

    function setLevelThresholds(uint256[] calldata thresholds) external onlyOwner {
        levelThresholds = thresholds;
        emit LevelThresholdsUpdated(thresholds);
    }
}
