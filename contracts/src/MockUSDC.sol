// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC20} from "openzeppelin-contracts/token/ERC20/ERC20.sol";

/// @title MockUSDC
/// @notice 6-decimal test dollar deployed on Ethereum Sepolia so the demo never depends on a
///         third-party faucet. Attestcoin proves an ERC-20 `Transfer` event either way, so the
///         verification path is identical to Circle's USDC.
/// @dev Open `mint` on purpose -- this is a testnet demo token with no value.
contract MockUSDC is ERC20 {
    constructor() ERC20("USD Coin (Vouch Test)", "USDC") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    /// @notice Anyone may mint. Hand a judge 100 USDC on the spot.
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    /// @notice Convenience faucet: 1,000 USDC to the caller.
    function faucet() external {
        _mint(msg.sender, 1_000 * 1e6);
    }
}
