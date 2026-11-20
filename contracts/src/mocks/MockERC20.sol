// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockERC20 is ERC20 {
    uint8 private immutable _decimals;

    constructor(string memory name_, string memory symbol_, uint8 decimals_) ERC20(name_, symbol_) {
        _decimals = decimals_;
    }

    function decimals() public view override returns (uint8) {
        return _decimals;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract MockFeeOnTransferERC20 is ERC20 {
    constructor() ERC20("Fee On Transfer", "FOT") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function _update(address from, address to, uint256 value) internal override {
        if (from != address(0) && to != address(0)) {
            uint256 fee = value / 100;
            super._update(from, address(0), fee);
            super._update(from, to, value - fee);
        } else {
            super._update(from, to, value);
        }
    }
}

contract MockRebasingERC20 {
    string public constant name = "Rebasing Token (test)";
    string public constant symbol = "REB";
    uint8 public constant decimals = 18;

    uint256 public totalSupply;
    uint256 private _totalShares;
    mapping(address account => uint256) private _shares;
    mapping(address owner => mapping(address spender => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    function balanceOf(address account) public view returns (uint256) {
        return _totalShares == 0 ? 0 : (_shares[account] * totalSupply) / _totalShares;
    }

    function mint(address to, uint256 amount) external {
        uint256 shares = _totalShares == 0 ? amount : (amount * _totalShares) / totalSupply;
        _shares[to] += shares;
        _totalShares += shares;
        totalSupply += amount;
        emit Transfer(address(0), to, amount);
    }

    function rebase(uint256 numerator, uint256 denominator) external {
        totalSupply = (totalSupply * numerator) / denominator;
    }

    function approve(address spender, uint256 value) external returns (bool) {
        allowance[msg.sender][spender] = value;
        emit Approval(msg.sender, spender, value);
        return true;
    }

    function transfer(address to, uint256 value) external returns (bool) {
        _transfer(msg.sender, to, value);
        return true;
    }

    function transferFrom(address from, address to, uint256 value) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed != type(uint256).max) {
            require(allowed >= value, "allowance");
            allowance[from][msg.sender] = allowed - value;
        }
        _transfer(from, to, value);
        return true;
    }

    function _transfer(address from, address to, uint256 value) private {
        uint256 shares = (value * _totalShares) / totalSupply;
        require(_shares[from] >= shares, "balance");
        _shares[from] -= shares;
        _shares[to] += shares;
        emit Transfer(from, to, value);
    }
}

contract MockReentrantERC20 is ERC20 {
    address public callbackTarget;
    bytes public callbackData;
    bool public armed;

    constructor() ERC20("Reentrant", "REE") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function arm(address target_, bytes calldata data_) external {
        callbackTarget = target_;
        callbackData = data_;
        armed = true;
    }

    function _update(address from, address to, uint256 value) internal override {
        super._update(from, to, value);
        if (armed && from != address(0) && to != address(0)) {
            armed = false;
            (bool ok, bytes memory ret) = callbackTarget.call(callbackData);
            if (!ok) {
                assembly ("memory-safe") {
                    revert(add(ret, 0x20), mload(ret))
                }
            }
        }
    }
}
