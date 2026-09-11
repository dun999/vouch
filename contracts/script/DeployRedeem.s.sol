// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {StarRedeem} from "../src/StarRedeem.sol";

/// @notice Deploys StarRedeem against an existing VouchCore. No rewiring needed:
///         redemption reads starsOf and keeps its own redeemed ledger.
///         Fund the treasury afterwards with StarRedeem.fund{value: ...}().
contract DeployRedeem is Script {
    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(pk);
        address vouch = vm.envAddress("VOUCH_CORE");

        vm.startBroadcast(pk);
        StarRedeem redeem = new StarRedeem(vouch, deployer);
        vm.stopBroadcast();

        console.log("chainId    ", block.chainid);
        console.log("StarRedeem ", address(redeem));
        console.log("VouchCore  ", vouch);
    }
}
