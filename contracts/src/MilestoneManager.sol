// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface ICommerceOwner {
    function ownerOfCommerce(uint256 commerceId) external view returns (address);
}

/// @title MilestoneManager
/// @notice Collective merchant campaigns: "if this coffee sells 50 today, every buyer gets 200 CTC."
///         Like quests, a campaign pays CTC cashback and never stars.
///
/// @dev Only VouchCore may record units, so a milestone can only ever be advanced by a purchase
///      Attestcoin has already proven. Reward is a fixed per-user amount and the budget is a hard
///      cap: once the pool is drained, later claimants get nothing. The merchant can never
///      overspend, and the buyer knows the exact amount up front.
contract MilestoneManager {
    struct Campaign {
        uint256 commerceId;
        string title;           // shown as the campaign's name on the quest board
        string description;     // the merchant's own pitch
        uint256 targetUnits;    // purchases needed to unlock
        uint256 minSpend;       // per-purchase minimum to count as a unit (token base units)
        uint256 rewardPerUser;  // CTC each qualifying buyer may claim
        uint256 budget;         // remaining CTC
        uint64 startsAt;
        uint64 endsAt;          // 0 == no expiry
        uint256 unitsSold;
        uint32 participantCount;
        bool active;
    }

    address public immutable core;
    ICommerceOwner public immutable registry;

    uint256 public nextCampaignId = 1;
    mapping(uint256 => Campaign) private _campaigns;
    mapping(uint256 => uint256[]) private _campaignsByCommerce;
    /// @notice campaignId => user => units contributed (0 means not enrolled)
    mapping(uint256 => mapping(address => uint256)) public unitsOf;
    mapping(uint256 => mapping(address => bool)) public claimed;

    mapping(address => uint256) public claimable;
    uint256 public totalClaimable;

    event CampaignCreated(
        uint256 indexed campaignId,
        uint256 indexed commerceId,
        string title,
        uint256 targetUnits,
        uint256 rewardPerUser,
        uint256 budget
    );
    event CampaignFunded(uint256 indexed campaignId, uint256 amount, uint256 newBudget);
    event CampaignActiveSet(uint256 indexed campaignId, bool active);
    event UnitRecorded(uint256 indexed campaignId, address indexed user, uint256 unitsSold, bool reached);
    event MilestoneReached(uint256 indexed campaignId, uint256 unitsSold);
    event RewardClaimed(uint256 indexed campaignId, address indexed user, uint256 amount);
    event Withdrawn(address indexed user, uint256 amount);
    event BudgetReclaimed(uint256 indexed campaignId, address indexed to, uint256 amount);

    error NotCore();
    error NotCommerceOwner();
    error UnknownCampaign();
    error InvalidCampaign();
    error MissingTitle();
    error MilestoneNotReached();
    error NotAParticipant();
    error AlreadyClaimed();
    error PoolExhausted();
    error NothingToWithdraw();
    error TransferFailed();
    error CampaignStillLive();

    constructor(address registry_, address core_) {
        registry = ICommerceOwner(registry_);
        core = core_;
    }

    modifier onlyMerchant(uint256 campaignId) {
        Campaign storage c = _campaigns[campaignId];
        if (c.commerceId == 0) revert UnknownCampaign();
        if (registry.ownerOfCommerce(c.commerceId) != msg.sender) revert NotCommerceOwner();
        _;
    }

    /// @notice Create and fund a milestone campaign in one call.
    function createCampaign(
        uint256 commerceId,
        string calldata title,
        string calldata description,
        uint256 targetUnits,
        uint256 minSpend,
        uint256 rewardPerUser,
        uint64 startsAt,
        uint64 endsAt
    ) external payable returns (uint256 campaignId) {
        if (registry.ownerOfCommerce(commerceId) != msg.sender) revert NotCommerceOwner();
        if (targetUnits == 0 || rewardPerUser == 0) revert InvalidCampaign();
        if (endsAt != 0 && endsAt <= (startsAt == 0 ? block.timestamp : startsAt)) revert InvalidCampaign();
        // A campaign that cannot pay even one claimant is a configuration bug.
        if (msg.value < rewardPerUser) revert InvalidCampaign();
        // The board lists campaigns by name alongside quests, so a name is required.
        if (bytes(title).length == 0) revert MissingTitle();

        campaignId = nextCampaignId++;
        _campaigns[campaignId] = Campaign({
            commerceId: commerceId,
            title: title,
            description: description,
            targetUnits: targetUnits,
            minSpend: minSpend,
            rewardPerUser: rewardPerUser,
            budget: msg.value,
            startsAt: startsAt == 0 ? uint64(block.timestamp) : startsAt,
            endsAt: endsAt,
            unitsSold: 0,
            participantCount: 0,
            active: true
        });
        _campaignsByCommerce[commerceId].push(campaignId);

        emit CampaignCreated(campaignId, commerceId, title, targetUnits, rewardPerUser, msg.value);
    }

    function fund(uint256 campaignId) external payable onlyMerchant(campaignId) {
        Campaign storage c = _campaigns[campaignId];
        c.budget += msg.value;
        emit CampaignFunded(campaignId, msg.value, c.budget);
    }

    function setActive(uint256 campaignId, bool active) external onlyMerchant(campaignId) {
        _campaigns[campaignId].active = active;
        emit CampaignActiveSet(campaignId, active);
    }

    /// @notice Count a verified purchase toward every live campaign of that merchant.
    /// @dev Called by VouchCore inside `recordPurchase`, so units only ever come from proven
    ///      payments. Never reverts on a non-qualifying campaign -- that would brick the purchase.
    function recordUnit(uint256 commerceId, address user, uint256 amount) external {
        if (msg.sender != core) revert NotCore();

        uint256[] storage ids = _campaignsByCommerce[commerceId];
        for (uint256 i = 0; i < ids.length; i++) {
            uint256 id = ids[i];
            Campaign storage c = _campaigns[id];
            if (!c.active) continue;
            if (block.timestamp < c.startsAt) continue;
            if (c.endsAt != 0 && block.timestamp > c.endsAt) continue;
            if (amount < c.minSpend) continue;

            bool wasReached = c.unitsSold >= c.targetUnits;
            c.unitsSold += 1;
            if (unitsOf[id][user] == 0) c.participantCount += 1;
            unitsOf[id][user] += 1;

            bool reached = c.unitsSold >= c.targetUnits;
            if (reached && !wasReached) emit MilestoneReached(id, c.unitsSold);
            emit UnitRecorded(id, user, c.unitsSold, reached);
        }
    }

    /// @notice Claim a fixed reward once the merchant's target has been reached.
    function claim(uint256 campaignId) external returns (uint256 amount) {
        Campaign storage c = _campaigns[campaignId];
        if (c.commerceId == 0) revert UnknownCampaign();
        if (c.unitsSold < c.targetUnits) revert MilestoneNotReached();
        if (unitsOf[campaignId][msg.sender] == 0) revert NotAParticipant();
        if (claimed[campaignId][msg.sender]) revert AlreadyClaimed();

        amount = c.rewardPerUser;
        if (c.budget < amount) revert PoolExhausted();

        claimed[campaignId][msg.sender] = true;
        c.budget -= amount;
        claimable[msg.sender] += amount;
        totalClaimable += amount;

        emit RewardClaimed(campaignId, msg.sender, amount);
    }

    /// @dev Pull payment, so no external call sits on the purchase or claim path.
    function withdraw() external returns (uint256 amount) {
        amount = claimable[msg.sender];
        if (amount == 0) revert NothingToWithdraw();

        claimable[msg.sender] = 0;
        totalClaimable -= amount;

        (bool ok,) = payable(msg.sender).call{value: amount}("");
        if (!ok) revert TransferFailed();
        emit Withdrawn(msg.sender, amount);
    }

    /// @notice Merchant reclaims leftover budget after the window closes.
    function reclaim(uint256 campaignId) external onlyMerchant(campaignId) returns (uint256 amount) {
        Campaign storage c = _campaigns[campaignId];
        // Cannot pull the rug while buyers can still qualify.
        if (c.active && (c.endsAt == 0 || block.timestamp <= c.endsAt)) revert CampaignStillLive();

        amount = c.budget;
        if (amount == 0) revert NothingToWithdraw();
        c.budget = 0;

        (bool ok,) = payable(msg.sender).call{value: amount}("");
        if (!ok) revert TransferFailed();
        emit BudgetReclaimed(campaignId, msg.sender, amount);
    }

    // ---------------------------------------------------------------- views

    function getCampaign(uint256 campaignId) external view returns (Campaign memory) {
        if (_campaigns[campaignId].commerceId == 0) revert UnknownCampaign();
        return _campaigns[campaignId];
    }

    function campaignsOfCommerce(uint256 commerceId) external view returns (uint256[] memory) {
        return _campaignsByCommerce[commerceId];
    }

    function totalCampaigns() external view returns (uint256) {
        return nextCampaignId - 1;
    }

    /// @notice How many more claims the remaining budget can honour.
    function remainingClaims(uint256 campaignId) external view returns (uint256) {
        Campaign storage c = _campaigns[campaignId];
        if (c.rewardPerUser == 0) return 0;
        return c.budget / c.rewardPerUser;
    }
}
