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

    /// @dev Each tier gets its own accent so the card visibly changes as the holder levels up.
    function _tier(uint32 level) private pure returns (string memory accent, string memory name) {
        if (level >= 5) return ("#f0abfc", "FOUNDING MEMBER");
        if (level == 4) return ("#fbbf24", "PATRON");
        if (level == 3) return ("#a78bfa", "INSIDER");
        if (level == 2) return ("#38bdf8", "REGULAR");
        return ("#94a3b8", "NEWCOMER");
    }

    /// @dev Progress through the current tier, 0-100. Full bar at max level.
    function _progressPct(uint32 level, uint256 stars) private view returns (uint256) {
        if (address(progression) == address(0)) return 0;
        uint256[] memory thr = progression.getLevelThresholds();
        if (level == 0 || level - 1 >= thr.length) return 100;
        uint256 next = thr[level - 1];
        uint256 prev = level >= 2 ? thr[level - 2] : 0;
        if (next <= prev || stars <= prev) return 0;
        uint256 pct = ((stars - prev) * 100) / (next - prev);
        return pct > 100 ? 100 : pct;
    }

    function _defs(string memory accent) private pure returns (string memory) {
        return string.concat(
            '<defs>',
            '<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">',
            '<stop offset="0%" stop-color="#0a0f1e"/><stop offset="55%" stop-color="#111a33"/>',
            '<stop offset="100%" stop-color="#1b1740"/></linearGradient>',
            '<linearGradient id="acc" x1="0" y1="0" x2="1" y2="1">',
            '<stop offset="0%" stop-color="', accent, '"/><stop offset="100%" stop-color="#6366f1"/>',
            '</linearGradient>',
            '<radialGradient id="glow" cx="50%" cy="50%" r="50%">',
            '<stop offset="0%" stop-color="', accent, '" stop-opacity="0.35"/>',
            '<stop offset="100%" stop-color="', accent, '" stop-opacity="0"/></radialGradient>',
            '<pattern id="grid" width="24" height="24" patternUnits="userSpaceOnUse">',
            '<path d="M24 0H0V24" fill="none" stroke="#ffffff" stroke-opacity="0.045"/></pattern>',
            '<clipPath id="card"><rect x="10" y="10" width="380" height="540" rx="24"/></clipPath>',
            '</defs>'
        );
    }

    function _header(string memory accent) private pure returns (string memory) {
        return string.concat(
            '<rect x="32" y="34" width="30" height="30" rx="9" fill="url(#acc)"/>',
            '<text x="47" y="55" font-family="monospace" font-size="18" font-weight="bold"',
            ' fill="#0a0f1e" text-anchor="middle">V</text>',
            '<text x="74" y="50" font-family="monospace" font-size="17" fill="#e8eef8"'
            ' letter-spacing="2">VOUCH</text>',
            '<text x="74" y="64" font-family="monospace" font-size="9" fill="', accent,
            '" letter-spacing="3">BENEFIT PASS</text>',
            // Padlock: the pass is soulbound, and the art should say so without words.
            '<g transform="translate(340,36)" fill="none" stroke="', accent, '" stroke-width="2">',
            '<rect x="2" y="9" width="16" height="13" rx="3" fill="', accent, '" fill-opacity="0.18"/>',
            '<path d="M6 9V6a4 4 0 0 1 8 0v3"/></g>',
            '<path d="M32 84h336" stroke="#ffffff" stroke-opacity="0.12" stroke-width="1"/>'
        );
    }

    /// @dev The object the pass is actually about: a paper receipt, stamped as verified.
    function _receipt(string memory accent) private pure returns (string memory) {
        return string.concat(
            '<g transform="translate(112,106)">',
            '<rect x="6" y="8" width="176" height="182" rx="6" fill="#000000" fill-opacity="0.35"/>',
            // Paper, with a torn zigzag bottom edge.
            '<path d="M0 0h176v168l-11 7-11-7-11 7-11-7-11 7-11-7-11 7-11-7-11 7-11-7-11 7-11-7-11 7-11-7-11 7-11-7z"',
            ' fill="#f6f8fc"/>',
            '<text x="16" y="30" font-family="monospace" font-size="11" fill="#0f172a"',
            ' letter-spacing="2">RECEIPT</text>',
            '<path d="M16 40h144" stroke="#0f172a" stroke-opacity="0.25" stroke-width="1"/>',
            // Line items.
            '<g fill="#0f172a" fill-opacity="0.72">',
            '<rect x="16" y="52" width="72" height="6" rx="3"/><rect x="126" y="52" width="34" height="6" rx="3"/>',
            '<rect x="16" y="68" width="88" height="6" rx="3"/><rect x="132" y="68" width="28" height="6" rx="3"/>',
            '<rect x="16" y="84" width="60" height="6" rx="3"/><rect x="130" y="84" width="30" height="6" rx="3"/>',
            '</g>',
            '<path d="M16 102h144" stroke="#0f172a" stroke-opacity="0.25" stroke-dasharray="3 3"/>',
            '<rect x="16" y="112" width="46" height="8" rx="4" fill="#0f172a"/>',
            '<rect x="112" y="112" width="48" height="8" rx="4" fill="#0f172a"/>',
            // Barcode, drawn as one thick dashed stroke.
            '<path d="M16 142h144" stroke="#0f172a" stroke-width="20"',
            ' stroke-dasharray="3 4 6 3 2 5 7 3 3 6 2 4 8 3 3 5 2 6"/>',
            '</g>',
            // Verification seal, overlapping the receipt's corner.
            '<g transform="translate(258,236)">',
            '<circle r="34" fill="#0a0f1e" stroke="', accent, '" stroke-width="2"/>',
            '<circle r="27" fill="none" stroke="', accent, '" stroke-opacity="0.45" stroke-dasharray="2 4"/>',
            '<path d="M-12 1l8 9 17-19" fill="none" stroke="', accent,
            '" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>',
            '<text y="24" font-family="monospace" font-size="7" fill="', accent,
            '" text-anchor="middle" letter-spacing="1">ATTESTED</text></g>'
        );
    }

    function _level(uint32 level, string memory accent, string memory tierName)
        private
        pure
        returns (string memory)
    {
        return string.concat(
            '<g transform="translate(32,318)">',
            '<path d="M28 0l24 14v28L28 56 4 42V14z" fill="url(#acc)" fill-opacity="0.18" stroke="', accent,
            '" stroke-width="1.5"/>',
            '<text x="28" y="36" font-family="monospace" font-size="20" font-weight="bold" fill="', accent,
            '" text-anchor="middle">', Strings.toString(level), '</text>',
            '<text x="70" y="24" font-family="monospace" font-size="11" fill="#94a3b8"',
            ' letter-spacing="2">LEVEL</text>',
            '<text x="70" y="46" font-family="monospace" font-size="15" fill="#e8eef8"',
            ' letter-spacing="1">', tierName, '</text></g>'
        );
    }

    function _progress(uint256 stars, uint256 pct, string memory accent) private pure returns (string memory) {
        return string.concat(
            '<g transform="translate(32,398)">',
            '<text font-family="monospace" font-size="9" fill="#64748b" letter-spacing="2">VERIFIED STARS</text>',
            '<text x="336" font-family="monospace" font-size="9" fill="', accent,
            '" text-anchor="end" letter-spacing="1">', Strings.toString(stars), '</text>',
            '<rect y="10" width="336" height="8" rx="4" fill="#ffffff" fill-opacity="0.08"/>',
            '<rect y="10" width="', Strings.toString((336 * pct) / 100),
            '" height="8" rx="4" fill="url(#acc)"/></g>'
        );
    }

    /// @dev The route the stars actually travelled. Sepolia pays, Attestcoin proves, Creditcoin records.
    function _rail(string memory accent) private pure returns (string memory) {
        return string.concat(
            '<g transform="translate(32,452)" font-family="monospace" font-size="8" fill="#64748b">',
            '<path d="M8 12h320" stroke="#ffffff" stroke-opacity="0.14" stroke-width="1"/>',
            '<circle cx="8" cy="12" r="5" fill="#0a0f1e" stroke="#64748b" stroke-width="2"/>',
            '<circle cx="168" cy="12" r="6" fill="', accent, '" fill-opacity="0.25" stroke="', accent,
            '" stroke-width="2"/>',
            '<circle cx="328" cy="12" r="5" fill="', accent, '" stroke="', accent, '" stroke-width="2"/>',
            '<text x="0" y="32" letter-spacing="1">SEPOLIA</text>',
            '<text x="168" y="32" text-anchor="middle" letter-spacing="1" fill="', accent, '">ATTESTCOIN</text>',
            '<text x="336" y="32" text-anchor="end" letter-spacing="1">CREDITCOIN</text></g>'
        );
    }

    function _renderSvg(uint256 tokenId, address user, uint32 level, uint256 stars)
        private
        view
        returns (string memory)
    {
        (string memory accent, string memory tierName) = _tier(level);
        return string.concat(
            '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="560" viewBox="0 0 400 560">',
            _defs(accent),
            '<rect width="400" height="560" fill="#05070d"/>',
            '<g clip-path="url(#card)">',
            '<rect x="10" y="10" width="380" height="540" fill="url(#bg)"/>',
            '<rect x="10" y="10" width="380" height="540" fill="url(#grid)"/>',
            '<circle cx="330" cy="120" r="190" fill="url(#glow)"/></g>',
            '<rect x="10" y="10" width="380" height="540" rx="24" fill="none" stroke="', accent,
            '" stroke-opacity="0.55" stroke-width="1.5"/>',
            _header(accent),
            _receipt(accent),
            _level(level, accent, tierName),
            _progress(stars, _progressPct(level, stars), accent),
            _rail(accent),
            '<text x="32" y="524" font-family="monospace" font-size="8" fill="#475569">',
            Strings.toHexString(uint160(user), 20), '</text>',
            '<text x="368" y="524" font-family="monospace" font-size="8" fill="#475569"',
            ' text-anchor="end">#', Strings.toString(tokenId), ' SOULBOUND</text>',
            '</svg>'
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
