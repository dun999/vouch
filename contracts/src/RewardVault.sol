// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ICommerceRegistry} from "./interfaces/IVouch.sol";

interface ICommerceOwner {
    function ownerOfCommerce(uint256 commerceId) external view returns (address);
}

/// @title RewardVault
/// @notice Holds merchant-funded CTC cashback campaigns.
/// @dev Cashback is credited, not sent. Keeping the purchase path free of external calls means a
///      user with a reverting fallback (or an out-of-gas receiver) cannot brick their own or
///      anyone else's `recordPurchase`; they simply withdraw later.
contract RewardVault {
    address public immutable core;
    ICommerceOwner public immutable registry;

    mapping(uint256 => uint256) public campaignBalance;
    mapping(address => uint256) public claimable;
    uint256 public totalClaimable;

    event CampaignFunded(uint256 indexed commerceId, address indexed funder, uint256 amount, uint256 newBalance);
    event CashbackCredited(uint256 indexed commerceId, address indexed user, uint256 amount);
    event CashbackWithdrawn(address indexed user, uint256 amount);
    event CampaignDefunded(uint256 indexed commerceId, address indexed to, uint256 amount);

    error NotCore();
    error NotCommerceOwner();
    error CampaignUnderfunded(uint256 commerceId, uint256 requested, uint256 available);
    error NothingToWithdraw();
    error TransferFailed();
    error ZeroAmount();

    constructor(address registry_, address core_) {
        registry = ICommerceOwner(registry_);
        core = core_;
    }

    /// @notice Merchants prefund cashback in CTC before any funded reward can pay out.
    function fund(uint256 commerceId) external payable {
        if (msg.value == 0) revert ZeroAmount();
        campaignBalance[commerceId] += msg.value;
        emit CampaignFunded(commerceId, msg.sender, msg.value, campaignBalance[commerceId]);
    }

    /// @notice Move cashback from a merchant campaign into a user's claimable balance.
    function credit(uint256 commerceId, address user, uint256 amount) external {
        if (msg.sender != core) revert NotCore();
        if (amount == 0) return;

        uint256 available = campaignBalance[commerceId];
        if (available < amount) revert CampaignUnderfunded(commerceId, amount, available);

        campaignBalance[commerceId] = available - amount;
        claimable[user] += amount;
        totalClaimable += amount;
        emit CashbackCredited(commerceId, user, amount);
    }

    function withdraw() external returns (uint256 amount) {
        amount = claimable[msg.sender];
        if (amount == 0) revert NothingToWithdraw();

        claimable[msg.sender] = 0;
        totalClaimable -= amount;

        (bool ok,) = payable(msg.sender).call{value: amount}("");
        if (!ok) revert TransferFailed();
        emit CashbackWithdrawn(msg.sender, amount);
    }

    /// @notice Merchant reclaims unspent campaign budget. Cannot touch credited user balances.
    function defund(uint256 commerceId, uint256 amount) external {
        if (registry.ownerOfCommerce(commerceId) != msg.sender) revert NotCommerceOwner();
        uint256 available = campaignBalance[commerceId];
        if (available < amount) revert CampaignUnderfunded(commerceId, amount, available);

        campaignBalance[commerceId] = available - amount;
        (bool ok,) = payable(msg.sender).call{value: amount}("");
        if (!ok) revert TransferFailed();
        emit CampaignDefunded(commerceId, msg.sender, amount);
    }
}
