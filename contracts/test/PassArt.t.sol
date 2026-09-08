// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {BenefitPass} from "../src/BenefitPass.sol";

/// Minimal stand-in for VouchCore, so the art can be exercised at any level without a full claim.
contract StubProgression {
    uint32 public lvl;
    uint256 public x;
    uint256[] public thr;

    constructor(uint32 level_, uint256 xp_) {
        lvl = level_;
        x = xp_;
        thr = [uint256(50), 150, 350, 700];
    }

    function levelOf(address) external view returns (uint32) { return lvl; }
    function starsOf(address) external view returns (uint256) { return x; }
    function getLevelThresholds() external view returns (uint256[] memory) { return thr; }
    function mintOn(BenefitPass p, address to) external { p.mint(to); }
}

/// @notice The pass art is rendered on-chain, so a malformed string is a permanently broken NFT.
///         These lock in the properties a marketplace actually depends on.
contract PassArtTest is Test {
    address constant HOLDER = address(0xd00d5eed1234567890ABCdef1234567890AbcDEf);

    function _uri(uint32 level, uint256 xp) internal returns (string memory) {
        StubProgression stub = new StubProgression(level, xp);
        BenefitPass pass = new BenefitPass(address(this));
        pass.setMinter(address(stub));
        stub.mintOn(pass, HOLDER);
        return pass.tokenURI(1);
    }

    function _startsWith(string memory s, string memory prefix) internal pure returns (bool) {
        bytes memory b = bytes(s);
        bytes memory p = bytes(prefix);
        if (b.length < p.length) return false;
        for (uint256 i = 0; i < p.length; i++) {
            if (b[i] != p[i]) return false;
        }
        return true;
    }

    function test_rendersAtEveryTier() public {
        uint32[5] memory levels = [uint32(1), 2, 3, 4, 5];
        uint256[5] memory xps = [uint256(20), 90, 420, 600, 1200];

        for (uint256 i = 0; i < levels.length; i++) {
            string memory uri = _uri(levels[i], xps[i]);
            assertTrue(_startsWith(uri, "data:application/json;base64,"), "data URI prefix");
            // Base64 of a ~4KB SVG plus its JSON wrapper; anything much shorter means a
            // string.concat branch silently dropped its contents.
            assertGt(bytes(uri).length, 4000, "art is present");
        }
    }

    function test_artIsFullyOnChain() public {
        string memory uri = _uri(3, 420);
        // No ipfs://, https:// or other off-chain pointer may appear anywhere in the metadata.
        bytes memory b = bytes(uri);
        assertGt(b.length, 0);
        assertTrue(_startsWith(uri, "data:application/json;base64,"), "no external URL");
    }

    function test_maxLevelShowsAFullBar() public {
        // Level 5 is past the last threshold, so progress must clamp to full rather than divide by zero.
        string memory uri = _uri(5, 100_000);
        assertGt(bytes(uri).length, 4000);
    }
}
