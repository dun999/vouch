// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Ownable} from "openzeppelin-contracts/access/Ownable.sol";

/// @notice Minimal view into VouchCore: redemption only needs the star balance.
interface IStarSource {
    function starsOf(address user) external view returns (uint256);
}

/// @title StarRedeem
/// @notice Lets Level 5 collectors turn surplus stars into CTC: 100 stars = 10 CTC.
///         Spendable stars are whatever sits above `floorStars` (700, the Level 5 line)
///         minus what the account already redeemed. Levels never drop: redemption is tracked
///         in this contract's own ledger, so VouchCore needs no changes and no redeploy.
///
/// @dev Holds its own CTC treasury, funded by the owner via `fund`. A redemption is a direct
///      transfer, not a claim-then-withdraw flow, so there is no second step to forget.
contract StarRedeem is Ownable {
    IStarSource public immutable vouch;

    /// @notice Stars an account must keep untouched. Defaults to the Level 5 threshold.
    uint256 public floorStars = 700;
    /// @notice CTC wei paid per star. 0.1 ether => 100 stars redeem for 10 CTC.
    uint256 public ctcPerStar = 0.1 ether;

    /// @notice Stars already redeemed per account. Never decreases.
    mapping(address => uint256) public redeemed;

    event Redeemed(address indexed user, uint256 stars, uint256 ctc);
    event Funded(address indexed from, uint256 amount);
    event RateUpdated(uint256 ctcPerStar);
    event FloorUpdated(uint256 floorStars);

    error ZeroAmount();
    error AboveSpendable(uint256 requested, uint256 spendable);
    error InsufficientTreasury(uint256 needed, uint256 balance);
    error TransferFailed();

    constructor(address vouch_, address initialOwner) Ownable(initialOwner) {
        vouch = IStarSource(vouch_);
    }

    /// @notice Stars this account can still turn into CTC.
    function spendableOf(address user) public view returns (uint256) {
        uint256 stars = vouch.starsOf(user);
        uint256 floor = floorStars + redeemed[user];
        return stars > floor ? stars - floor : 0;
    }

    /// @notice CTC wei a star amount redeems for at the current rate.
    function quote(uint256 starAmount) public view returns (uint256) {
        return starAmount * ctcPerStar;
    }

    function treasury() external view returns (uint256) {
        return address(this).balance;
    }

    /// @notice Burn `starAmount` of surplus stars for CTC at the current rate.
    function redeem(uint256 starAmount) external {
        if (starAmount == 0) revert ZeroAmount();
        uint256 spendable = spendableOf(msg.sender);
        if (starAmount > spendable) revert AboveSpendable(starAmount, spendable);

        uint256 payout = quote(starAmount);
        if (address(this).balance < payout) revert InsufficientTreasury(payout, address(this).balance);

        redeemed[msg.sender] += starAmount;
        (bool ok,) = payable(msg.sender).call{value: payout}("");
        if (!ok) revert TransferFailed();
        emit Redeemed(msg.sender, starAmount, payout);
    }

    function fund() external payable {
        emit Funded(msg.sender, msg.value);
    }

    receive() external payable {
        emit Funded(msg.sender, msg.value);
    }

    // ---------------------------------------------------------------- admin

    function setRate(uint256 ctcPerStar_) external onlyOwner {
        ctcPerStar = ctcPerStar_;
        emit RateUpdated(ctcPerStar_);
    }

    function setFloor(uint256 floorStars_) external onlyOwner {
        floorStars = floorStars_;
        emit FloorUpdated(floorStars_);
    }

    function withdraw(uint256 amount) external onlyOwner {
        (bool ok,) = payable(owner()).call{value: amount}("");
        if (!ok) revert TransferFailed();
    }
}
