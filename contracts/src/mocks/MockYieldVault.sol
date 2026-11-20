// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC4626} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";

contract MockYieldVault is ERC4626 {
    address private immutable _deployer;
    bool public redemptionsPaused;

    error NotDeployer();

    constructor(IERC20 asset_, string memory name_, string memory symbol_) ERC20(name_, symbol_) ERC4626(asset_) {
        _deployer = msg.sender;
    }

    function setRedemptionsPaused(bool paused) external {
        if (msg.sender != _deployer) revert NotDeployer();
        redemptionsPaused = paused;
    }

    function maxRedeem(address owner) public view override returns (uint256) {
        return redemptionsPaused ? 0 : super.maxRedeem(owner);
    }

    function maxWithdraw(address owner) public view override returns (uint256) {
        return redemptionsPaused ? 0 : super.maxWithdraw(owner);
    }
}
