// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface ICommerceRegistry {
    function commerceIdByPayout(address payout) external view returns (uint256);
    function isActive(uint256 commerceId) external view returns (bool);
}

interface IBenefitPass {
    function mint(address to) external returns (uint256);
    function tokenOfOwner(address user) external view returns (uint256);
}

interface IQuestManager {
    /// @return completed  true if this purchase finished the quest
    /// @return cashback   CTC to credit from the merchant's campaign
    /// @dev Quests never return stars. Stars are a protocol-level function of verified spend
    ///      alone, so a merchant cannot inflate a customer's level with a generous quest.
    function tryComplete(
        address user,
        uint256 questId,
        uint256 commerceId,
        uint256 itemId,
        uint256 purchaseValue,
        uint32 userLevel
    ) external returns (bool completed, uint256 cashback);
}

interface IAppCashback {
    /// @notice Protocol-funded cashback, a percentage of spend scaled by the buyer's level.
    /// @dev Must never revert: a stale price feed or an empty treasury cannot be allowed to brick
    ///      a purchase that Attestcoin already proved.
    /// @param level The level held *before* this purchase's XP landed.
    /// @return paid CTC credited to the buyer, possibly zero.
    function credit(address user, uint32 level, uint256 usdcAmount) external returns (uint256 paid);
}

interface ICatalog {
    /// @notice Count a proven purchase against a menu item's finite stock.
    /// @return sold true if a unit was actually consumed.
    function recordSale(uint256 commerceId, uint256 itemId, address buyer, uint256 amountPaid)
        external
        returns (bool sold);
}

interface IRewardVault {
    function credit(uint256 commerceId, address user, uint256 amount) external;
}

interface IMilestoneManager {
    /// @notice Count a verified purchase toward the merchant's live milestone campaigns.
    function recordUnit(uint256 commerceId, address user, uint256 amount) external;
}
