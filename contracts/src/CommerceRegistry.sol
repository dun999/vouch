// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title CommerceRegistry
/// @notice Merchant directory. Maps a merchant's Sepolia payout address back to a commerce id so
///         VouchCore can attribute a proven payment to a merchant.
contract CommerceRegistry {
    struct Commerce {
        address owner;          // merchant's Creditcoin address
        address sepoliaPayout;  // Sepolia address that receives customer ETH
        string name;
        string metadataURI;
        bool active;
    }

    /// @dev Ids start at 1 so that 0 reliably means "not registered".
    uint256 public nextCommerceId = 1;

    mapping(uint256 => Commerce) private _commerces;
    /// @notice Reverse lookup used by VouchCore to attribute a proven Sepolia transfer.
    mapping(address => uint256) public commerceIdByPayout;
    mapping(address => uint256[]) private _commercesByOwner;

    event CommerceRegistered(
        uint256 indexed commerceId, address indexed owner, address indexed sepoliaPayout, string name
    );
    event CommerceUpdated(uint256 indexed commerceId, string name, string metadataURI);
    event CommerceActiveSet(uint256 indexed commerceId, bool active);

    error PayoutAlreadyRegistered(address payout, uint256 existingCommerceId);
    error ZeroPayoutAddress();
    error NotCommerceOwner();
    error UnknownCommerce();

    modifier onlyCommerceOwner(uint256 commerceId) {
        if (_commerces[commerceId].owner != msg.sender) revert NotCommerceOwner();
        _;
    }

    /// @notice Register a merchant. A payout address may back only one commerce, otherwise a
    ///         payment could be attributed to two merchants at once.
    function register(string calldata name, string calldata metadataURI, address sepoliaPayout)
        external
        returns (uint256 commerceId)
    {
        if (sepoliaPayout == address(0)) revert ZeroPayoutAddress();
        uint256 existing = commerceIdByPayout[sepoliaPayout];
        if (existing != 0) revert PayoutAlreadyRegistered(sepoliaPayout, existing);

        commerceId = nextCommerceId++;
        _commerces[commerceId] = Commerce(msg.sender, sepoliaPayout, name, metadataURI, true);
        commerceIdByPayout[sepoliaPayout] = commerceId;
        _commercesByOwner[msg.sender].push(commerceId);

        emit CommerceRegistered(commerceId, msg.sender, sepoliaPayout, name);
    }

    function updateProfile(uint256 commerceId, string calldata name, string calldata metadataURI)
        external
        onlyCommerceOwner(commerceId)
    {
        Commerce storage c = _commerces[commerceId];
        c.name = name;
        c.metadataURI = metadataURI;
        emit CommerceUpdated(commerceId, name, metadataURI);
    }

    function setActive(uint256 commerceId, bool active) external onlyCommerceOwner(commerceId) {
        _commerces[commerceId].active = active;
        emit CommerceActiveSet(commerceId, active);
    }

    function getCommerce(uint256 commerceId) external view returns (Commerce memory) {
        if (_commerces[commerceId].owner == address(0)) revert UnknownCommerce();
        return _commerces[commerceId];
    }

    function isActive(uint256 commerceId) external view returns (bool) {
        return _commerces[commerceId].active;
    }

    function ownerOfCommerce(uint256 commerceId) external view returns (address) {
        return _commerces[commerceId].owner;
    }

    function commercesOf(address owner) external view returns (uint256[] memory) {
        return _commercesByOwner[owner];
    }

    function totalCommerces() external view returns (uint256) {
        return nextCommerceId - 1;
    }
}
