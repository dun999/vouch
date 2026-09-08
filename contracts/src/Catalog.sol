// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface ICatalogRegistry {
    function ownerOfCommerce(uint256 commerceId) external view returns (address);
}

/// @title Catalog
/// @notice A merchant's menu: named items with an exact price and a finite stock.
///
/// @dev This exists so a customer is never asked to "spend $5" at a storefront without being told
///      what $5 buys. A quest points at an item, the item carries its own price, and the pay flow
///      is "buy this thing" rather than "type an amount".
///
///      Stock is decremented only when VouchCore accepts an Attestcoin-proven payment, so the
///      `sold` counter is a count of real, verified sales -- a merchant cannot inflate it, and a
///      buyer cannot claim a unit they did not pay for.
contract Catalog {
    struct Item {
        uint256 commerceId;
        string name;
        string description;
        uint256 price;   // exact price in payment-token base units (USDC, 6dp)
        uint32 stock;    // units listed
        uint32 sold;     // units sold against a proven payment
        bool active;
    }

    ICatalogRegistry public immutable registry;
    address public immutable core;

    uint256 public nextItemId = 1;
    mapping(uint256 => Item) private _items;
    mapping(uint256 => uint256[]) private _itemsByCommerce;

    event ItemListed(uint256 indexed itemId, uint256 indexed commerceId, string name, uint256 price, uint32 stock);
    event ItemRestocked(uint256 indexed itemId, uint32 added, uint32 newStock);
    event ItemActiveSet(uint256 indexed itemId, bool active);
    event ItemSold(uint256 indexed itemId, address indexed buyer, uint32 sold, uint32 remaining);

    error NotCore();
    error NotCommerceOwner();
    error UnknownItem();
    error InvalidItem();

    constructor(address registry_, address core_) {
        registry = ICatalogRegistry(registry_);
        core = core_;
    }

    modifier onlyMerchant(uint256 itemId) {
        Item storage it = _items[itemId];
        if (it.commerceId == 0) revert UnknownItem();
        if (registry.ownerOfCommerce(it.commerceId) != msg.sender) revert NotCommerceOwner();
        _;
    }

    /// @notice Put a named item on the menu with an exact price and a finite number of units.
    function listItem(uint256 commerceId, string calldata name, string calldata description, uint256 price, uint32 stock)
        external
        returns (uint256 itemId)
    {
        if (registry.ownerOfCommerce(commerceId) != msg.sender) revert NotCommerceOwner();
        // A nameless item, a free item, or an item with nothing to sell is a configuration bug.
        if (bytes(name).length == 0 || price == 0 || stock == 0) revert InvalidItem();

        itemId = nextItemId++;
        _items[itemId] = Item({
            commerceId: commerceId,
            name: name,
            description: description,
            price: price,
            stock: stock,
            sold: 0,
            active: true
        });
        _itemsByCommerce[commerceId].push(itemId);
        emit ItemListed(itemId, commerceId, name, price, stock);
    }

    function restock(uint256 itemId, uint32 addUnits) external onlyMerchant(itemId) {
        if (addUnits == 0) revert InvalidItem();
        Item storage it = _items[itemId];
        it.stock += addUnits;
        emit ItemRestocked(itemId, addUnits, it.stock);
    }

    function setActive(uint256 itemId, bool active) external onlyMerchant(itemId) {
        _items[itemId].active = active;
        emit ItemActiveSet(itemId, active);
    }

    /// @notice Count one proven purchase against an item's stock.
    /// @dev Called by VouchCore only, and deliberately returns `false` rather than reverting for
    ///      every non-qualifying case: a stale, foreign, sold-out or underpaid itemId must never
    ///      brick the purchase claim that carries it. The customer still gets their receipt and XP.
    function recordSale(uint256 commerceId, uint256 itemId, address buyer, uint256 amountPaid)
        external
        returns (bool sold)
    {
        if (msg.sender != core) revert NotCore();

        Item storage it = _items[itemId];
        if (it.commerceId == 0 || it.commerceId != commerceId) return false;
        if (!it.active) return false;
        if (it.sold >= it.stock) return false;
        // Underpaying must not consume a unit; overpaying is the buyer's business.
        if (amountPaid < it.price) return false;

        it.sold += 1;
        emit ItemSold(itemId, buyer, it.sold, it.stock - it.sold);
        return true;
    }

    // ---------------------------------------------------------------- views

    function getItem(uint256 itemId) external view returns (Item memory) {
        if (_items[itemId].commerceId == 0) revert UnknownItem();
        return _items[itemId];
    }

    function itemsOfCommerce(uint256 commerceId) external view returns (uint256[] memory) {
        return _itemsByCommerce[commerceId];
    }

    /// @notice Units still available. Zero means sold out.
    function remaining(uint256 itemId) external view returns (uint32) {
        Item storage it = _items[itemId];
        return it.sold >= it.stock ? 0 : it.stock - it.sold;
    }

    function totalItems() external view returns (uint256) {
        return nextItemId - 1;
    }
}
