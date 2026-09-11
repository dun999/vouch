// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {CommerceRegistry} from "../src/CommerceRegistry.sol";
import {BenefitPass} from "../src/BenefitPass.sol";
import {VouchCore} from "../src/VouchCore.sol";
import {QuestManager} from "../src/QuestManager.sol";
import {RewardVault} from "../src/RewardVault.sol";
import {MilestoneManager} from "../src/MilestoneManager.sol";
import {Catalog} from "../src/Catalog.sol";
import {PriceOracle} from "../src/PriceOracle.sol";
import {AppCashback} from "../src/AppCashback.sol";
import {StarRedeem} from "../src/StarRedeem.sol";
import {NativeQueryVerifierLib} from "../src/vendor/INativeQueryVerifier.sol";

/// @notice Deploys the Vouch stack to Creditcoin CC3 testnet (chainId 102031).
/// @dev Passing verifier = address(0) makes VouchCore bind the real 0x0FD2 precompile.
contract Deploy is Script {
    /// Sepolia's Attestcoin chain key, confirmed from `get_supported_chains()` on 0x0FD3.
    uint64 constant SEPOLIA_CHAIN_KEY = 1;
    /// Ethereum mainnet. PriceOracle reads Uniswap V2 Sync events from this chain; payments stay on Sepolia.
    uint64 constant ETHEREUM_CHAIN_KEY = 3;

    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(pk);
        // MockUSDC on Sepolia (6 decimals). Payments are ERC-20 transfers of this token.
        address paymentToken = vm.envAddress("PAYMENT_TOKEN");

        require(
            NativeQueryVerifierLib.isCreditcoinChainId(block.chainid),
            "Deploy: must target a Creditcoin chain (the block prover precompile lives there)"
        );

        vm.startBroadcast(pk);

        CommerceRegistry registry = new CommerceRegistry();
        BenefitPass pass = new BenefitPass(deployer);
        VouchCore core = new VouchCore(SEPOLIA_CHAIN_KEY, address(registry), address(pass), address(0), deployer);
        QuestManager quests = new QuestManager(address(registry), address(core));
        RewardVault vault = new RewardVault(address(registry), address(core));
        MilestoneManager milestones = new MilestoneManager(address(registry), address(core));
        Catalog catalog = new Catalog(address(registry), address(core));
        PriceOracle oracle = new PriceOracle(ETHEREUM_CHAIN_KEY, address(0), deployer);
        AppCashback appCashback = new AppCashback(address(core), address(oracle), deployer);
        // Star redemption needs no VouchCore wiring: it reads starsOf and keeps its own
        // redeemed ledger. Fund it with CTC after deploy (StarRedeem.fund{value:...}).
        StarRedeem starRedeem = new StarRedeem(address(core), deployer);

        pass.setMinter(address(core));
        core.setPaymentToken(paymentToken, 6);
        core.setQuestManager(address(quests));
        core.setRewardVault(address(vault));
        core.setMilestoneManager(address(milestones));
        core.setCatalog(address(catalog));
        core.setAppCashback(address(appCashback));

        vm.stopBroadcast();

        console.log("chainId          ", block.chainid);
        console.log("CommerceRegistry ", address(registry));
        console.log("BenefitPass      ", address(pass));
        console.log("VouchCore        ", address(core));
        console.log("QuestManager     ", address(quests));
        console.log("RewardVault      ", address(vault));
        console.log("MilestoneManager ", address(milestones));
        console.log("Catalog          ", address(catalog));
        console.log("PriceOracle      ", address(oracle));
        console.log("AppCashback      ", address(appCashback));
        console.log("StarRedeem       ", address(starRedeem));
        console.log("PaymentToken     ", paymentToken);
    }
}
