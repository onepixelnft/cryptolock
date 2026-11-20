// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

contract MockPriceFeed {
    uint8 public immutable decimals;
    string public description;
    int256 private _answer;
    uint80 private _roundId;

    constructor(uint8 decimals_, string memory description_, int256 answer_) {
        decimals = decimals_;
        description = description_;
        _answer = answer_;
        _roundId = 1;
    }

    function setAnswer(int256 answer_) external {
        _answer = answer_;
        _roundId += 1;
    }

    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)
    {
        return (_roundId, _answer, block.timestamp, block.timestamp, _roundId);
    }
}
