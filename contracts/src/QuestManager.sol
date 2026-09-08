// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ICommerceRegistry} from "./interfaces/IVouch.sol";

/// @title QuestManager
/// @notice Merchant-created spending quests. Progress only ever advances from a purchase that
///         VouchCore has already proven via Attestcoin.
///
/// @dev A quest pays CTC cashback and nothing else. Stars are deliberately not a merchant lever --
///      VouchCore derives them from verified spend alone -- so no storefront can mint progression
///      for its own customers.
contract QuestManager {
    struct Quest {
        uint256 commerceId;
        string title;          // shown as the quest's name
        string description;    // what the customer gets, in the merchant's own words
        uint256 itemId;        // the catalog item this quest is about; 0 == any item here
        uint32 minPurchases;   // e.g. "buy 2 flat whites"
        uint256 minSpendWei;   // cumulative spend at this merchant
        uint256 cashback;      // fixed CTC amount, funded by the merchant's campaign
        uint32 minLevel;       // gates better rewards behind progression
        uint64 startsAt;
        uint64 endsAt;         // 0 == no expiry
        uint32 maxClaims;      // 0 == unlimited
        uint32 claims;
        bool active;
    }

    struct Progress {
        uint32 purchases;
        uint256 spendWei;
    }

    ICommerceRegistry public immutable registry;
    address public immutable core;

    uint256 public nextQuestId = 1;
    mapping(uint256 => Quest) private _quests;
    mapping(uint256 => uint256[]) private _questsByCommerce;
    mapping(address => mapping(uint256 => Progress)) public progressOf;
    mapping(address => mapping(uint256 => bool)) public completedBy;

    event QuestCreated(uint256 indexed questId, uint256 indexed commerceId, string title, uint256 cashback);
    event QuestActiveSet(uint256 indexed questId, bool active);
    event QuestProgressed(address indexed user, uint256 indexed questId, uint32 purchases, uint256 spendWei);
    event QuestCompleted(address indexed user, uint256 indexed questId);

    error NotCore();
    error NotCommerceOwner();
    error UnknownQuest();
    error InvalidQuest();
    error MissingTitle();

    /// @dev Params are grouped so the signature stays readable and Solidity's stack stays shallow.
    struct NewQuest {
        uint256 commerceId;
        string title;
        string description;
        uint256 itemId;
        uint32 minPurchases;
        uint256 minSpendWei;
        uint256 cashback;
        uint32 minLevel;
        uint64 startsAt;
        uint64 endsAt;
        uint32 maxClaims;
    }

    constructor(address registry_, address core_) {
        registry = ICommerceRegistry(registry_);
        core = core_;
    }

    function createQuest(NewQuest calldata q) external returns (uint256 questId) {
        if (ICommerceRegistryOwner(address(registry)).ownerOfCommerce(q.commerceId) != msg.sender) {
            revert NotCommerceOwner();
        }
        // A quest nobody can ever finish is a configuration bug, not a valid campaign.
        if (q.minPurchases == 0 && q.minSpendWei == 0) revert InvalidQuest();
        if (q.endsAt != 0 && q.endsAt <= q.startsAt) revert InvalidQuest();
        // The board lists quests by name, so an unnamed quest would be unreadable.
        if (bytes(q.title).length == 0) revert MissingTitle();

        questId = nextQuestId++;
        _quests[questId] = Quest({
            commerceId: q.commerceId,
            title: q.title,
            description: q.description,
            itemId: q.itemId,
            minPurchases: q.minPurchases,
            minSpendWei: q.minSpendWei,
            cashback: q.cashback,
            minLevel: q.minLevel,
            startsAt: q.startsAt == 0 ? uint64(block.timestamp) : q.startsAt,
            endsAt: q.endsAt,
            maxClaims: q.maxClaims,
            claims: 0,
            active: true
        });
        _questsByCommerce[q.commerceId].push(questId);
        emit QuestCreated(questId, q.commerceId, q.title, q.cashback);
    }

    function setActive(uint256 questId, bool active) external {
        Quest storage q = _quests[questId];
        if (q.commerceId == 0) revert UnknownQuest();
        if (ICommerceRegistryOwner(address(registry)).ownerOfCommerce(q.commerceId) != msg.sender) {
            revert NotCommerceOwner();
        }
        q.active = active;
        emit QuestActiveSet(questId, active);
    }

    /// @notice Advance a user's progress from a verified purchase.
    /// @dev Returns `false` rather than reverting for every non-qualifying case, so that passing a
    ///      stale, foreign or ineligible questId can never brick the underlying purchase claim.
    function tryComplete(
        address user,
        uint256 questId,
        uint256 commerceId,
        uint256 itemId,
        uint256 purchaseValue,
        uint32 userLevel
    ) external returns (bool completed, uint256 cashback) {
        if (msg.sender != core) revert NotCore();

        Quest storage q = _quests[questId];
        if (q.commerceId == 0 || !q.active) return (false, 0);
        if (q.commerceId != commerceId) return (false, 0);
        // A quest about a specific menu item only advances when that item was the thing bought.
        if (q.itemId != 0 && q.itemId != itemId) return (false, 0);
        if (completedBy[user][questId]) return (false, 0);
        if (userLevel < q.minLevel) return (false, 0);
        if (block.timestamp < q.startsAt) return (false, 0);
        if (q.endsAt != 0 && block.timestamp > q.endsAt) return (false, 0);
        if (q.maxClaims != 0 && q.claims >= q.maxClaims) return (false, 0);

        Progress storage p = progressOf[user][questId];
        p.purchases += 1;
        p.spendWei += purchaseValue;
        emit QuestProgressed(user, questId, p.purchases, p.spendWei);

        if (p.purchases < q.minPurchases || p.spendWei < q.minSpendWei) return (false, 0);

        completedBy[user][questId] = true;
        q.claims += 1;
        emit QuestCompleted(user, questId);
        return (true, q.cashback);
    }

    function getQuest(uint256 questId) external view returns (Quest memory) {
        if (_quests[questId].commerceId == 0) revert UnknownQuest();
        return _quests[questId];
    }

    function questsOfCommerce(uint256 commerceId) external view returns (uint256[] memory) {
        return _questsByCommerce[commerceId];
    }

    function totalQuests() external view returns (uint256) {
        return nextQuestId - 1;
    }
}

interface ICommerceRegistryOwner {
    function ownerOfCommerce(uint256 commerceId) external view returns (address);
}
