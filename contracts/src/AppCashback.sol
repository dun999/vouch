// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Ownable} from "openzeppelin-contracts/access/Ownable.sol";

interface IPriceOracleView {
    function readRate() external view returns (uint256 rate, bool fresh);
}

/// @title AppCashback
/// @notice Protocol-funded cashback, paid as a percentage of every verified purchase and scaled by
///         the buyer's level: nothing at level 1, 2% at level 2, rising to 10% at level 5.
///
/// @dev This is the second, separate cashback stream. `RewardVault` holds *merchant* money and pays
///      for finishing a merchant's quest. This holds *the app's* money and pays on every proven
///      purchase, anywhere. Keeping them in different contracts keeps the accounting honest — a
///      merchant can never be drained by the protocol's promise, and vice versa.
///
///      The rate is a function of level, and level is a function of verified spend alone, so this
///      is the concrete thing a level buys. It is also why merchants cannot grant XP: if they
///      could, they could mint their customers into the protocol's own 10% bracket.
contract AppCashback is Ownable {
    address public immutable core;
    IPriceOracleView public oracle;

    /// @notice Basis points of spend returned, indexed by level - 1. Levels past the end use the
    ///         last entry, so the top tier is the cap.
    uint16[] public levelRateBps;

    /// @notice CTC held to pay cashback. Tracked explicitly so `claimable` can never exceed it.
    uint256 public treasury;
    mapping(address => uint256) public claimable;
    uint256 public totalClaimable;

    /// @notice The payment token's decimals, for converting spend into dollars.
    uint8 public paymentDecimals = 6;

    event Funded(address indexed from, uint256 amount, uint256 treasury);
    event Credited(address indexed user, uint32 level, uint16 rateBps, uint256 usdcSpent, uint256 ctcPaid);
    event Skipped(address indexed user, string reason);
    event Withdrawn(address indexed user, uint256 amount);
    event RatesSet(uint16[] levelRateBps);
    event OracleSet(address oracle);

    error NotCore();
    error NothingToWithdraw();
    error TransferFailed();
    error NothingToReclaim();
    error InvalidRates();

    constructor(address core_, address oracle_, address initialOwner) Ownable(initialOwner) {
        core = core_;
        oracle = IPriceOracleView(oracle_);
        // Level 1 earns nothing; the ladder is what levelling up is for.
        levelRateBps = [0, 200, 400, 700, 1000];
    }

    // ---------------------------------------------------------------- funding

    /// @notice Top up the cashback treasury. Anyone may fund it; only the protocol drains it.
    function fund() external payable {
        treasury += msg.value;
        emit Funded(msg.sender, msg.value, treasury);
    }

    receive() external payable {
        treasury += msg.value;
        emit Funded(msg.sender, msg.value, treasury);
    }

    // ---------------------------------------------------------------- rates

    function rateBpsForLevel(uint32 level) public view returns (uint16) {
        uint256 n = levelRateBps.length;
        if (n == 0 || level == 0) return 0;
        uint256 i = level - 1;
        return i >= n ? levelRateBps[n - 1] : levelRateBps[i];
    }

    function getLevelRates() external view returns (uint16[] memory) {
        return levelRateBps;
    }

    /// @notice What this purchase would pay, ignoring whether the treasury can cover it.
    function quote(uint32 level, uint256 usdcAmount) public view returns (uint256) {
        uint16 bps = rateBpsForLevel(level);
        if (bps == 0 || address(oracle) == address(0)) return 0;
        (uint256 rate, bool fresh) = oracle.readRate();
        if (!fresh) return 0;
        // usdc base units -> whole dollars -> CTC wei -> percentage.
        return (usdcAmount * rate * bps) / (10 ** paymentDecimals) / 10_000;
    }

    // ---------------------------------------------------------------- credit

    /// @notice Credit a verified purchase. Called by VouchCore only.
    /// @dev Never reverts. A stale price feed or an empty treasury must not brick someone's
    ///      purchase — the receipt, the XP and the merchant's own cashback all still stand. It
    ///      pays what it can and says why when it cannot, so the app can surface the reason.
    /// @param level The buyer's level *before* this purchase's XP landed, matching quest gating:
    ///        one purchase can raise a level or earn the higher rate, never both.
    function credit(address user, uint32 level, uint256 usdcAmount) external returns (uint256 paid) {
        if (msg.sender != core) revert NotCore();

        uint256 owed = quote(level, usdcAmount);
        if (owed == 0) {
            if (rateBpsForLevel(level) != 0) emit Skipped(user, "no fresh price");
            return 0;
        }

        uint256 free = treasury - totalClaimable;
        if (free == 0) {
            emit Skipped(user, "treasury empty");
            return 0;
        }
        // Pay partially rather than nothing when the treasury is nearly drained.
        paid = owed > free ? free : owed;

        claimable[user] += paid;
        totalClaimable += paid;

        emit Credited(user, level, rateBpsForLevel(level), usdcAmount, paid);
    }

    /// @dev Pull payment, so no external call ever sits on the purchase path.
    function withdraw() external returns (uint256 amount) {
        amount = claimable[msg.sender];
        if (amount == 0) revert NothingToWithdraw();

        claimable[msg.sender] = 0;
        totalClaimable -= amount;
        treasury -= amount;

        (bool ok,) = payable(msg.sender).call{value: amount}("");
        if (!ok) revert TransferFailed();
        emit Withdrawn(msg.sender, amount);
    }

    // ---------------------------------------------------------------- admin

    function setRates(uint16[] calldata bps) external onlyOwner {
        // 100% back would make spending free and the treasury a faucet.
        for (uint256 i = 0; i < bps.length; i++) {
            if (bps[i] > 5_000) revert InvalidRates();
        }
        levelRateBps = bps;
        emit RatesSet(bps);
    }

    function setOracle(address oracle_) external onlyOwner {
        oracle = IPriceOracleView(oracle_);
        emit OracleSet(oracle_);
    }

    function setPaymentDecimals(uint8 d) external onlyOwner {
        paymentDecimals = d;
    }

    /// @notice Withdraw treasury that is not already owed to somebody.
    function reclaim(uint256 amount) external onlyOwner {
        uint256 free = treasury - totalClaimable;
        if (amount == 0 || amount > free) revert NothingToReclaim();
        treasury -= amount;
        (bool ok,) = payable(msg.sender).call{value: amount}("");
        if (!ok) revert TransferFailed();
    }
}
