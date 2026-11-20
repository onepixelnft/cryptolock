// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Multicall} from "@openzeppelin/contracts/utils/Multicall.sol";

contract MockMulticallERC20 is ERC20, Multicall {
    constructor() ERC20("Multicall Token", "MCT") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract MockERC6909 {
    mapping(address owner => mapping(address spender => bool)) public isOperator;
    mapping(address owner => mapping(address spender => mapping(uint256 id => uint256))) public allowance;

    function setOperator(address spender, bool approved) external returns (bool) {
        isOperator[msg.sender][spender] = approved;
        return true;
    }

    function approve(address spender, uint256 id, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender][id] = amount;
        return true;
    }
}
