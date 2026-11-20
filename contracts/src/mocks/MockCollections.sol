// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ERC721Enumerable} from "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";
import {ERC1155} from "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";

library TestArt {
    using Strings for uint256;

    function svg(uint256 id, bool edition) internal pure returns (string memory) {
        uint256 inset = 40 + (id % 5) * 28;
        uint256 size = 400 - 2 * inset;
        string memory mark = edition
            ? string.concat('<circle cx="200" cy="200" r="', (30 + (id % 4) * 22).toString(), '" fill="#000"/>')
            : string.concat(
                '<rect x="185" y="', (90 + (id % 3) * 40).toString(), '" width="30" height="', (220 - (id % 3) * 80).toString(),
                '" fill="#000"/>'
            );
        return string.concat(
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400"><rect width="400" height="400" fill="#fff"/>',
            '<rect x="', inset.toString(), '" y="', inset.toString(), '" width="', size.toString(), '" height="',
            size.toString(), '" fill="none" stroke="#000" stroke-width="6"/>', mark,
            '<text x="24" y="380" font-family="monospace" font-size="26" fill="#000">#', id.toString(), "</text></svg>"
        );
    }

    function metadata(string memory name, uint256 id, bool edition) internal pure returns (string memory) {
        string memory json = string.concat(
            '{"name":"', name, " #", id.toString(), '","description":"Local test asset. No value.","image":"data:image/svg+xml;base64,',
            Base64.encode(bytes(svg(id, edition))), '"}'
        );
        return string.concat("data:application/json;base64,", Base64.encode(bytes(json)));
    }
}

contract MockCollectibles is ERC721Enumerable {
    constructor() ERC721("Test Collectibles", "TCOL") {}

    function mint(address to, uint256 tokenId) external {
        _mint(to, tokenId);
    }

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);
        return TestArt.metadata("Test Collectible", tokenId, false);
    }
}

contract MockEditions is ERC1155 {
    string public constant name = "Test Editions";
    string public constant symbol = "TED";

    constructor() ERC1155("") {}

    function mint(address to, uint256 id, uint256 amount) external {
        _mint(to, id, amount, "");
    }

    function uri(uint256 id) public pure override returns (string memory) {
        return TestArt.metadata("Test Edition", id, true);
    }
}
