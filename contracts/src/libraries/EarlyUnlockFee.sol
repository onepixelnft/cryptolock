// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

library EarlyUnlockFee {
    uint256 internal constant BPS = 10_000;

    function feeBps(uint256 minFeeBps, uint256 maxFeeBps, uint256 start, uint256 end, uint256 timestamp)
        internal
        pure
        returns (uint256)
    {
        if (timestamp >= end) return 0;
        uint256 total = end - start;
        uint256 from = timestamp > start ? timestamp : start;
        uint256 remaining = end - from;
        return minFeeBps + Math.mulDiv(maxFeeBps - minFeeBps, remaining, total);
    }

    function feeAmount(uint256 amount, uint256 bps) internal pure returns (uint256) {
        return Math.mulDiv(amount, bps, BPS);
    }
}
