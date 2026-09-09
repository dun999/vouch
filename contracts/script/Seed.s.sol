// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {CommerceRegistry} from "../src/CommerceRegistry.sol";
import {QuestManager} from "../src/QuestManager.sol";
import {RewardVault} from "../src/RewardVault.sol";
import {MilestoneManager} from "../src/MilestoneManager.sol";
import {Catalog} from "../src/Catalog.sol";
import {PriceOracle} from "../src/PriceOracle.sol";
import {AppCashback} from "../src/AppCashback.sol";

/// @notice Seeds demo merchants, their menus, quests and funded cashback campaigns.
/// @dev The deployer plays all three merchants. Each needs a DISTINCT Sepolia payout address --
///      the registry enforces one storefront per payout address, which is what makes a proven
///      payment unambiguously attributable to a merchant.
///
///      Every quest points at a listed menu item, so the board reads "buy 2 flat whites" rather
///      than "spend $5 on something".
contract Seed is Script {
    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        CommerceRegistry registry = CommerceRegistry(vm.envAddress("COMMERCE_REGISTRY"));
        QuestManager quests = QuestManager(vm.envAddress("QUEST_MANAGER"));
        RewardVault vault = RewardVault(payable(vm.envAddress("REWARD_VAULT")));
        Catalog catalog = Catalog(vm.envAddress("CATALOG"));
        PriceOracle oracle = PriceOracle(vm.envAddress("PRICE_ORACLE"));
        AppCashback appCashback = AppCashback(payable(vm.envAddress("APP_CASHBACK")));
        MilestoneManager milestones = MilestoneManager(payable(vm.envAddress("MILESTONE_MANAGER")));

        address payoutCoffee = vm.envOr("PAYOUT_COFFEE", address(0xC0FFEe0000000000000000000000000000000001));
        address payoutBooks = vm.envOr("PAYOUT_BOOKS", address(0xB00c500000000000000000000000000000000002));
        address payoutRamen = vm.envOr("PAYOUT_RAMEN", address(0x4A4e000000000000000000000000000000000003));

        vm.startBroadcast(pk);

        uint256 coffee = registry.register("Ada's Coffee Bar", "", payoutCoffee);
        uint256 books = registry.register("Turing Books", "", payoutBooks);
        uint256 ramen = registry.register("Hopper Ramen", "", payoutRamen);

        // ---------------------------------------------------------------- menus
        // Named stock at an exact price. This is what a customer actually buys.
        uint256 flatWhite = catalog.listItem(
            coffee, "Flat White", "Double ristretto, steamed whole milk, 6oz.", 2_500_000, 80
        );
        uint256 coldBrew = catalog.listItem(
            coffee, "Cold Brew", "18-hour steep, served over ice.", 3_500_000, 60
        );
        catalog.listItem(coffee, "Almond Croissant", "Baked each morning, gone by noon.", 2_000_000, 40);

        uint256 paperback = catalog.listItem(
            books, "Paperback Classic", "Any title from the front table.", 6_000_000, 25
        );
        catalog.listItem(books, "Reading Room Pass", "A day at the back desk, coffee included.", 4_000_000, 30);

        uint256 shoyu = catalog.listItem(ramen, "Shoyu Ramen", "Chintan broth, chashu, ajitama.", 8_000_000, 50);
        catalog.listItem(ramen, "Gyoza (5pc)", "Pan-fried, folded to order.", 4_500_000, 60);
        catalog.listItem(ramen, "Iced Matcha", "Ceremonial grade, lightly sweetened.", 3_000_000, 40);

        // ---------------------------------------------------------------- quests
        // Every quest pays CTC cashback and names the item it is about. XP is not a merchant
        // lever -- it comes from verified spend alone.
        uint256 q1 = quests.createQuest(
            QuestManager.NewQuest({
                commerceId: coffee,
                title: "Two-cup starter",
                description: "Buy two Flat Whites and the second effectively pays for itself in CTC.",
                itemId: flatWhite,
                minPurchases: 2,
                minSpendWei: 0,
                cashback: 0.1 ether,
                minLevel: 1,
                startsAt: 0,
                endsAt: 0,
                maxClaims: 0
            })
        );
        uint256 q2 = quests.createQuest(
            QuestManager.NewQuest({
                commerceId: coffee,
                title: "Cold Brew regular",
                description: "One Cold Brew, for level 2 and up. Our regulars get the better rate.",
                itemId: coldBrew,
                minPurchases: 1,
                minSpendWei: 0,
                cashback: 0.25 ether,
                minLevel: 2,
                startsAt: 0,
                endsAt: 0,
                maxClaims: 0
            })
        );
        uint256 q3 = quests.createQuest(
            QuestManager.NewQuest({
                commerceId: books,
                title: "First chapter",
                description: "Pick up one Paperback Classic and earn cashback on your first order.",
                itemId: paperback,
                minPurchases: 1,
                minSpendWei: 0,
                cashback: 0.1 ether,
                minLevel: 1,
                startsAt: 0,
                endsAt: 0,
                maxClaims: 0
            })
        );
        uint256 q4 = quests.createQuest(
            QuestManager.NewQuest({
                commerceId: ramen,
                title: "Three-bowl club",
                description: "Three bowls of Shoyu Ramen unlocks the biggest cashback on the board.",
                itemId: shoyu,
                minPurchases: 3,
                minSpendWei: 0,
                cashback: 0.5 ether,
                minLevel: 2,
                startsAt: 0,
                endsAt: 0,
                maxClaims: 0
            })
        );

        // ---------------------------------------------------------------- cashback + campaigns
        vault.fund{value: 2 ether}(coffee);
        vault.fund{value: 1 ether}(books);
        vault.fund{value: 2 ether}(ramen);

        milestones.createCampaign{value: 4 ether}(
            coffee,
            "Sell-out Saturday",
            "If the bar clears 20 drinks today, everyone who bought one claims CTC back. No draw, no luck.",
            20,
            2_000_000,
            0.2 ether,
            0,
            0
        );
        milestones.createCampaign{value: 3 ether}(
            ramen,
            "Rush hour",
            "Ten bowls before close and every diner claims cashback.",
            10,
            4_000_000,
            0.3 ether,
            0,
            0
        );

        // ---------------------------------------------------------------- app cashback
        // Priced from a Uniswap V2 Sync on Ethereum mainnet (Attestcoin chain key 3). There is no
        // CTC/USDC V2 pair; WCTC(old)/USDT is the Sync-compatible USD pool. `pnpm sync:price`
        // pushes a live proof after seed — until then the rate is unset and app cashback pays 0.
        oracle.setPair(0x4a4F4fcA1a9B673f9eB23b7EeFe9dFbafd8D8140, true, 18, 6);
        oracle.setBounds(0.01 ether, 10_000 ether, 7 days);
        appCashback.fund{value: 2000 ether}();

        vm.stopBroadcast();

        console.log("commerce ids : coffee=%s books=%s ramen=%s", coffee, books, ramen);
        console.log("quest ids    : %s %s %s", q1, q2, q3);
        console.log("quest id     : %s", q4);
        console.log("items listed : %s", catalog.totalItems());
        console.log("payout coffee: %s", payoutCoffee);
        console.log("payout books : %s", payoutBooks);
        console.log("payout ramen : %s", payoutRamen);
        console.log("Funded 5 CTC quest cashback, 7 CTC campaigns, 2000 CTC app cashback treasury.");
    }
}
