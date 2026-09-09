#!/usr/bin/env node
/// Diffs the TypeScript pass renderer against the Solidity one. BenefitPass renders the token
/// image on-chain; app/lib/passArt.ts mirrors it so the console can show the current design
/// without redeploying a contract VouchCore holds as an immutable. This is what keeps them honest.
///
/// Usage: pnpm pass:check
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// The Solidity side is exercised through a throwaway forge test that prints each tokenURI.
const CASES = [
  { level: 1, stars: 180n },
  { level: 2, stars: 940n },
  { level: 3, stars: 2600n },
  { level: 4, stars: 7100n },
  { level: 5, stars: 14250n },
];
const THRESHOLDS = [500n, 1500n, 4000n, 10000n];
const BASE_USER = 0xc40ebd2d5f3db115c5994be2e9863162154d2231n;

const test = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test, console2} from "forge-std/Test.sol";
import {BenefitPass} from "../src/BenefitPass.sol";
import {Strings} from "openzeppelin-contracts/utils/Strings.sol";

contract MockProgression {
    uint32 public lvl;
    uint256 public st;
    function set(uint32 l, uint256 s) external { lvl = l; st = s; }
    function levelOf(address) external view returns (uint32) { return lvl; }
    function starsOf(address) external view returns (uint256) { return st; }
    function getLevelThresholds() external pure returns (uint256[] memory t) {
        t = new uint256[](${THRESHOLDS.length});
${THRESHOLDS.map((v, i) => `        t[${i}] = ${v};`).join("\n")}
    }
}

contract PassArtParity is Test {
    function test_dump() public {
        BenefitPass pass = new BenefitPass(address(this));
        MockProgression prog = new MockProgression();
        pass.setMinter(address(prog));
        uint32[${CASES.length}] memory levels = [${CASES.map((c, i) => (i ? String(c.level) : `uint32(${c.level})`)).join(", ")}];
        uint256[${CASES.length}] memory stars = [${CASES.map((c, i) => (i ? String(c.stars) : `uint256(${c.stars})`)).join(", ")}];
        for (uint256 i = 0; i < ${CASES.length}; i++) {
            prog.set(levels[i], stars[i]);
            vm.prank(address(prog));
            uint256 id = pass.mint(address(uint160(${BASE_USER} + i)));
            console2.log(string.concat("@@", Strings.toString(i), "@@", pass.tokenURI(id)));
        }
    }
}
`;

const path = join(root, "contracts/test/PassArtParity.t.sol");
writeFileSync(path, test);

let out;
try {
  out = execFileSync("forge", ["test", "--root", join(root, "contracts"), "--match-path", "test/PassArtParity.t.sol", "-vv"], {
    encoding: "utf8", maxBuffer: 64 * 1024 * 1024,
  });
} finally {
  execFileSync("rm", ["-f", path]);
}

const { renderPassSvg } = await import(join(root, "app/lib/passArt.ts"));

let failed = 0;
for (const line of out.split("\n")) {
  const m = line.match(/@@(\d+)@@(data:application\/json;base64,\S+)/);
  if (!m) continue;
  const i = Number(m[1]);
  const json = JSON.parse(Buffer.from(m[2].split(",")[1], "base64").toString());
  const onChain = Buffer.from(json.image.split(",")[1], "base64").toString();
  const local = renderPassSvg({
    tokenId: BigInt(i + 1),
    user: "0x" + (BASE_USER + BigInt(i)).toString(16).padStart(40, "0"),
    level: CASES[i].level,
    stars: CASES[i].stars,
    thresholds: THRESHOLDS,
  });

  if (local === onChain) {
    console.log(`  level ${CASES[i].level}  identical (${onChain.length} bytes)`);
  } else {
    failed++;
    console.error(`  level ${CASES[i].level}  MISMATCH`);
    for (let k = 0; k < Math.max(local.length, onChain.length); k++) {
      if (local[k] !== onChain[k]) {
        console.error(`    first difference at byte ${k}`);
        console.error(`      solidity: ${JSON.stringify(onChain.slice(Math.max(0, k - 40), k + 60))}`);
        console.error(`      typescript: ${JSON.stringify(local.slice(Math.max(0, k - 40), k + 60))}`);
        break;
      }
    }
  }
}

if (failed) {
  console.error(`\n${failed} tier(s) differ. app/lib/passArt.ts and contracts/src/BenefitPass.sol must agree.`);
  process.exit(1);
}
console.log("\nBoth renderers agree on every tier.");
