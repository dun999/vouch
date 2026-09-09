// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {PriceOracle} from "../src/PriceOracle.sol";
import {AppCashback} from "../src/AppCashback.sol";
import {NativeQueryVerifierLib} from "../src/vendor/INativeQueryVerifier.sol";

/// @notice Deploys a PriceOracle keyed to Ethereum mainnet (Attestcoin chain key 3), points the
///         existing AppCashback at it, and tops up the protocol cashback treasury.
/// @dev Merchant RewardVault / quests / campaigns are not touched. A follow-up
///      `pnpm sync:price` pushes a live Uniswap V2 Sync proof into the new oracle.
contract ConfigureMainnetOracle is Script {
    /// Confirmed live from get_supported_chains() on 0x0FD3: (3, 1, "Ethereum").
    uint64 constant ETHEREUM_CHAIN_KEY = 3;
    /// Uniswap V2 WCTC (old) / USDT. There is no CTC/USDC V2 pair on Ethereum mainnet.
    address constant WCTC_USDT_V2 = 0x4a4F4fcA1a9B673f9eB23b7EeFe9dFbafd8D8140;

    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(pk);
        AppCashback appCashback = AppCashback(payable(vm.envAddress("APP_CASHBACK")));

        require(
            NativeQueryVerifierLib.isCreditcoinChainId(block.chainid),
            "ConfigureMainnetOracle: must target a Creditcoin chain"
        );
        require(appCashback.owner() == deployer, "ConfigureMainnetOracle: not AppCashback owner");

        vm.startBroadcast(pk);

        PriceOracle oracle = new PriceOracle(ETHEREUM_CHAIN_KEY, address(0), deployer);
        // token0 = WCTC 18dp, token1 = USDT 6dp.
        oracle.setPair(WCTC_USDT_V2, true, 18, 6);
        // A week of freshness so a proven rate is still usable across a demo day.
        oracle.setBounds(0.01 ether, 10_000 ether, 7 days);

        appCashback.setOracle(address(oracle));
        appCashback.fund{value: 2000 ether}();

        vm.stopBroadcast();

        console.log("PriceOracle      ", address(oracle));
        console.log("AppCashback      ", address(appCashback));
        console.log("CHAIN_KEY        ", ETHEREUM_CHAIN_KEY);
        console.log("pair             ", WCTC_USDT_V2);
    }
}
