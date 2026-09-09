// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC721} from "openzeppelin-contracts/token/ERC721/ERC721.sol";
import {Ownable} from "openzeppelin-contracts/access/Ownable.sol";
import {Strings} from "openzeppelin-contracts/utils/Strings.sol";
import {Base64} from "openzeppelin-contracts/utils/Base64.sol";

/// @notice Progression view that BenefitPass reads to render a live tokenURI.
interface IProgressionSource {
    function levelOf(address user) external view returns (uint32);
    function starsOf(address user) external view returns (uint256);
    function getLevelThresholds() external view returns (uint256[] memory);
}

/// @title BenefitPass
/// @notice Non-transferable (soulbound) ERC721. One per user, minted on first verified purchase.
///         Metadata is rendered on-chain from live VouchCore progression, so the pass visibly
///         gains stars without any re-mint or off-chain metadata service.
contract BenefitPass is ERC721, Ownable {
    uint256 public nextTokenId = 1;
    mapping(address => uint256) public tokenOfOwner;

    /// @notice VouchCore. Only it may mint.
    address public minter;
    IProgressionSource public progression;

    event MinterSet(address indexed minter);
    event PassMinted(address indexed user, uint256 indexed tokenId);

    error Soulbound();
    error AlreadyMinted();
    error NotMinter();
    error NoPass();

    constructor(address initialOwner) ERC721("Vouch Benefit Pass", "VOUCH") Ownable(initialOwner) {}

    function setMinter(address newMinter) external onlyOwner {
        minter = newMinter;
        progression = IProgressionSource(newMinter);
        emit MinterSet(newMinter);
    }

    function mint(address to) external returns (uint256 tokenId) {
        if (msg.sender != minter) revert NotMinter();
        if (tokenOfOwner[to] != 0) revert AlreadyMinted();

        tokenId = nextTokenId++;
        tokenOfOwner[to] = tokenId;
        _safeMint(to, tokenId);
        emit PassMinted(to, tokenId);
    }

    function hasPass(address user) external view returns (bool) {
        return tokenOfOwner[user] != 0;
    }

    /// @dev Soulbound: allow mint (from == 0) and burn (to == 0), block every transfer between users.
    function _update(address to, uint256 tokenId, address auth) internal override returns (address) {
        address from = _ownerOf(tokenId);
        if (from != address(0) && to != address(0)) revert Soulbound();
        return super._update(to, tokenId, auth);
    }

    /// @dev Approvals are meaningless for a soulbound token; reject them so nothing appears tradable.
    function approve(address, uint256) public pure override {
        revert Soulbound();
    }

    function setApprovalForAll(address, bool) public pure override {
        revert Soulbound();
    }

    // ---------------------------------------------------------------- artwork
    //
    // The pass is drawn as a piece of security printing, not as a poster: warm paper stock, an
    // engine-turned guilloche rosette, a perforated stub, and micro-print along the foot. Every
    // ornament is generated from the holder's own numbers rather than decorating around them --
    // the rosette is the tier's ink, the ledger bar is the star count, the rail is the route the
    // purchase actually took. Tiers change the ink colour, the way a real card series would.
    //
    // NOTE: app/lib/passArt.ts renders byte-identical SVG so the console can show a holder's pass
    //       without a redeploy. Change one, change the other.

    string private constant PAPER = "#F7F4ED";
    string private constant INK = "#252A24";
    string private constant MUTED = "#6E7468";
    string private constant RULE = "#C8C9BD";

    /// @dev Tier ink. Graphite, then green, indigo, the house terracotta, and gold at the top.
    function _tier(uint32 level) private pure returns (string memory accent, string memory name) {
        if (level >= 5) return ("#8A6A17", "FOUNDING MEMBER");
        if (level == 4) return ("#AD462C", "PATRON");
        if (level == 3) return ("#1F5670", "INSIDER");
        if (level == 2) return ("#286047", "REGULAR");
        return ("#6E7468", "NEWCOMER");
    }

    /// @dev Progress through the current tier and the line printed under the ledger bar.
    function _ladder(uint32 level, uint256 stars)
        private
        view
        returns (uint256 pct, string memory note)
    {
        if (address(progression) == address(0)) return (0, "AWAITING FIRST VERIFIED PURCHASE");

        uint256[] memory thr = progression.getLevelThresholds();
        if (level == 0 || level - 1 >= thr.length) return (100, "HIGHEST TIER REACHED");

        uint256 next = thr[level - 1];
        uint256 prev = level >= 2 ? thr[level - 2] : 0;
        note = string.concat(
            Strings.toString(stars >= next ? 0 : next - stars),
            " STARS TO LEVEL ",
            Strings.toString(level + 1)
        );
        if (next <= prev || stars <= prev) return (0, note);
        pct = ((stars - prev) * 100) / (next - prev);
        if (pct > 100) pct = 100;
    }

    /// @dev Engine turning. Two families of rotated ellipses interfere into a rosette -- the same
    ///      construction a banknote lathe draws, and the reason it is hard to fake by hand.
    function _rosette(uint32 level, string memory accent) private pure returns (string memory out) {
        // A higher tier is a more finely turned plate: more lines on the lathe, same diameter.
        uint256 outer = 24 + uint256(level > 5 ? 5 : level) * 5;
        uint256 inner = 12 + uint256(level > 5 ? 5 : level) * 3;

        out = string.concat(
            '<g transform="translate(173,208)" fill="none" stroke="', accent, '">',
            '<g stroke-width="0.45" opacity="0.38">'
        );
        for (uint256 i = 0; i < outer; i++) {
            out = string.concat(
                out,
                '<ellipse rx="88" ry="28" transform="rotate(',
                Strings.toString((i * 180) / outer),
                ')"/>'
            );
        }
        out = string.concat(out, '</g><g stroke-width="0.4" opacity="0.3">');
        for (uint256 i = 0; i < inner; i++) {
            out = string.concat(
                out,
                '<ellipse rx="54" ry="15" transform="rotate(',
                Strings.toString((i * 180) / inner + 7),
                ')"/>'
            );
        }
        return string.concat(out, "</g></g>");
    }

    function _header(uint256 tokenId, string memory accent) private pure returns (string memory) {
        return string.concat(
            '<rect x="34" y="34" width="28" height="28" rx="8" fill="', accent, '"/>',
            '<text x="48" y="54" font-family="Georgia, serif" font-size="17" font-weight="bold"',
            ' fill="', PAPER, '" text-anchor="middle">V</text>',
            '<text x="72" y="49" font-family="Georgia, serif" font-size="15" fill="', INK,
            '" letter-spacing="3.4">VOUCH</text>',
            '<text x="73" y="63" font-family="monospace" font-size="7.5" fill="', MUTED,
            '" letter-spacing="2.4">BENEFIT PASS</text>',
            '<text x="312" y="49" font-family="monospace" font-size="9" fill="', accent,
            '" text-anchor="end" letter-spacing="1.4">CREDITCOIN CC3</text>',
            '<text x="312" y="63" font-family="monospace" font-size="7.5" fill="', MUTED,
            '" text-anchor="end" letter-spacing="1.4">NON-TRANSFERABLE</text>',
            '<path d="M34 78h278" stroke="', RULE, '" stroke-width="1"/>',
            '<path d="M34 81h278" stroke="', RULE, '" stroke-width="0.4"/>',
            _stub(tokenId, accent)
        );
    }

    /// @dev The tear-off stub. A pass that cannot be transferred still gets the anatomy of a
    ///      ticket, because that is the object it stands in for.
    function _stub(uint256 tokenId, string memory accent) private pure returns (string memory) {
        return string.concat(
            '<path d="M326 20v520" stroke="', RULE, '" stroke-width="1" stroke-dasharray="2 4"/>',
            '<circle cx="326" cy="20" r="4" fill="', PAPER, '" stroke="', RULE, '" stroke-width="0.8"/>',
            '<circle cx="326" cy="540" r="4" fill="', PAPER, '" stroke="', RULE, '" stroke-width="0.8"/>',
            '<rect x="342" y="34" width="22" height="4" rx="2" fill="', accent, '"/>',
            '<g transform="translate(353,290) rotate(-90)" text-anchor="middle">',
            '<text y="-6" font-family="Georgia, serif" font-size="16" fill="', INK,
            '" letter-spacing="2">No. ', Strings.toString(tokenId), '</text>',
            '<text y="9" font-family="monospace" font-size="7" fill="', MUTED,
            '" letter-spacing="3.2">SOULBOUND</text></g>',
            '<rect x="342" y="522" width="22" height="4" rx="2" fill="', accent, '"/>'
        );
    }

    /// @dev The medallion: tier ink, engraved rules, and the level set in a book face.
    function _medallion(uint32 level, string memory accent, string memory tierName)
        private
        pure
        returns (string memory)
    {
        return string.concat(
            '<g transform="translate(173,208)">',
            '<circle r="46" fill="', PAPER, '" fill-opacity="0.94"/>',
            '<circle r="46" fill="none" stroke="', accent, '" stroke-width="1.2"/>',
            '<circle r="40" fill="none" stroke="', accent,
            '" stroke-width="0.5" stroke-dasharray="1 3"/>',
            '<text y="-16" font-family="monospace" font-size="7" fill="', MUTED,
            '" text-anchor="middle" letter-spacing="3.4">LEVEL</text>',
            '<text y="22" font-family="Georgia, serif" font-size="46" fill="', accent,
            '" text-anchor="middle">', Strings.toString(level), '</text></g>',
            '<path d="M34 317h', _flankWidth(tierName), '" stroke="', RULE, '" stroke-width="0.6"/>',
            '<text x="173" y="322" font-family="Georgia, serif" font-size="14" fill="', INK,
            '" text-anchor="middle" letter-spacing="4">', tierName, '</text>',
            '<path d="M312 317h-', _flankWidth(tierName), '" stroke="', RULE, '" stroke-width="0.6"/>'
        );
    }

    /// @dev The rules either side of the tier name stop short of it, so a long name never
    ///      collides with them. 7px per character is the width of this face at 14px.
    function _flankWidth(string memory tierName) private pure returns (string memory) {
        uint256 half = (bytes(tierName).length * 9) / 2 + 12;
        return Strings.toString(half >= 139 ? 10 : 139 - half);
    }

    /// @dev The star count as a ledger bar: twenty engraved cells, filled to the tier's progress.
    function _ledger(uint256 stars, uint256 pct, string memory accent, string memory note)
        private
        pure
        returns (string memory out)
    {
        out = string.concat(
            '<text x="34" y="358" font-family="monospace" font-size="7.5" fill="', MUTED,
            '" letter-spacing="2.6">VERIFIED STARS</text>',
            '<text x="312" y="360" font-family="Georgia, serif" font-size="18" fill="', accent,
            '" text-anchor="end">', Strings.toString(stars), '</text><g>'
        );
        uint256 filled = (pct * 20 + 50) / 100;
        for (uint256 i = 0; i < 20; i++) {
            out = string.concat(
                out,
                '<rect x="', Strings.toString(34 + i * 14), '" y="370" width="12" height="9" rx="1.5" ',
                i < filled
                    ? string.concat('fill="', accent, '"/>')
                    : string.concat('fill="none" stroke="', RULE, '" stroke-width="0.8"/>')
            );
        }
        return string.concat(
            out, '</g>',
            '<text x="34" y="396" font-family="monospace" font-size="7.5" fill="', MUTED,
            '" letter-spacing="1.8">', note, '</text>'
        );
    }

    /// @dev The route the stars travelled. Sepolia pays, Attestcoin proves, Creditcoin records --
    ///      three marks, drawn as three different things, because they are three different acts.
    function _rail(string memory accent) private pure returns (string memory) {
        return string.concat(
            '<g transform="translate(0,420)">',
            '<path d="M34 20h278" stroke="', RULE, '" stroke-width="0.8"/>',
            // Paid: a squared-off stamp.
            '<rect x="28" y="14" width="12" height="12" rx="2" fill="', PAPER, '" stroke="', accent,
            '" stroke-width="1.5"/>',
            // Proven: a filled seal with a cut mark, the only solid node on the rail.
            '<circle cx="173" cy="20" r="9" fill="', accent, '"/>',
            '<path d="M169 20l3 3 5-6" fill="none" stroke="', PAPER,
            '" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>',
            // Recorded: an open ring, because the ledger stays open.
            '<circle cx="312" cy="20" r="6" fill="', PAPER, '" stroke="', accent, '" stroke-width="1.5"/>',
            '<g font-family="monospace" font-size="7" fill="', MUTED, '" letter-spacing="1.6">',
            '<text x="34" y="40">SEPOLIA</text>',
            '<text x="173" y="40" text-anchor="middle" fill="', accent, '">ATTESTCOIN</text>',
            '<text x="312" y="40" text-anchor="end">CREDITCOIN</text></g>',
            '<g font-family="monospace" font-size="6" fill="', RULE, '" letter-spacing="1.2">',
            '<text x="34" y="52">PAID</text>',
            '<text x="173" y="52" text-anchor="middle">PROVEN</text>',
            '<text x="312" y="52" text-anchor="end">RECORDED</text></g></g>'
        );
    }

    /// @dev Micro-print. Legible only when enlarged, which is the point of it.
    function _footer(address user) private pure returns (string memory) {
        return string.concat(
            '<path d="M34 492h278" stroke="', RULE, '" stroke-width="0.6"/>',
            '<text x="34" y="510" font-family="monospace" font-size="8" fill="', INK,
            '" letter-spacing="0.4">', Strings.toHexString(uint160(user), 20), '</text>',
            '<text x="34" y="523" font-family="monospace" font-size="6.5" fill="', MUTED,
            '" letter-spacing="1.6">BEARER OF RECORD</text>',
            '<text x="34" y="535" font-family="monospace" font-size="3.6" fill="', RULE,
            '" letter-spacing="0.5">',
            "VOUCH*VERIFIED*COMMERCE*VOUCH*VERIFIED*COMMERCE*VOUCH*VERIFIED*COMMERCE*VOUCH*VERIFIED*COMMERCE*VOUCH*VERIFIED*COMMERCE*VOUCH*VERI",
            '</text>'
        );
    }

    function _renderSvg(uint256 tokenId, address user, uint32 level, uint256 stars)
        private
        view
        returns (string memory)
    {
        (string memory accent, string memory tierName) = _tier(level);
        (uint256 pct, string memory note) = _ladder(level, stars);

        return string.concat(
            '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="560" viewBox="0 0 400 560">',
            '<rect width="400" height="560" fill="#E7E2D6"/>',
            '<rect x="10" y="10" width="380" height="540" rx="18" fill="', PAPER,
            '" stroke="', RULE, '" stroke-width="1"/>',
            _rosette(level, accent),
            '<rect x="20" y="20" width="360" height="520" rx="12" fill="none" stroke="', accent,
            '" stroke-opacity="0.55" stroke-width="0.8"/>',
            _header(tokenId, accent),
            _medallion(level, accent, tierName),
            _ledger(stars, pct, accent, note),
            _rail(accent),
            _footer(user),
            "</svg>"
        );
    }

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);
        address user = ownerOf(tokenId);

        uint32 level = 1;
        uint256 stars = 0;
        if (address(progression) != address(0)) {
            level = progression.levelOf(user);
            stars = progression.starsOf(user);
        }

        (, string memory tierName) = _tier(level);
        string memory lvl = Strings.toString(level);
        string memory svg = _renderSvg(tokenId, user, level, stars);

        string memory json = string.concat(
            '{"name":"Vouch Benefit Pass #', Strings.toString(tokenId),
            '","description":"Non-transferable proof of verified commerce activity on Creditcoin. ',
            'Every star is a dollar actually spent and proven by Attestcoin. Level ', lvl,
            ' - ', tierName,
            '.","attributes":[{"trait_type":"Level","value":', lvl,
            '},{"trait_type":"Tier","value":"', tierName,
            '"},{"trait_type":"Stars","value":', Strings.toString(stars),
            '},{"trait_type":"Soulbound","value":"true"}],"image":"data:image/svg+xml;base64,',
            Base64.encode(bytes(svg)), '"}'
        );
        return string.concat("data:application/json;base64,", Base64.encode(bytes(json)));
    }
}
