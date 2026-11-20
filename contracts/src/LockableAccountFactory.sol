pragma solidity 0.8.28;

import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";

import {ProtocolConfig} from "./ProtocolConfig.sol";
import {LockableAccount} from "./LockableAccount.sol";

contract LockableAccountFactory {
    uint256 public constant PROTOCOL_VERSION = 3;

    LockableAccount public immutable implementation;
    ProtocolConfig public immutable config;

    event AccountCreated(address indexed account, address indexed owner, uint256 salt);

    constructor(ProtocolConfig config_) {
        config = config_;
        implementation = new LockableAccount(config_);
    }

    function createAccount(address owner, uint256 salt) external returns (address account) {
        bytes32 deploymentSalt = _deploymentSalt(owner, salt);
        account = Clones.predictDeterministicAddress(address(implementation), deploymentSalt);
        if (account.code.length != 0) return account;
        Clones.cloneDeterministic(address(implementation), deploymentSalt);
        LockableAccount(payable(account)).initialize(owner);
        emit AccountCreated(account, owner, salt);
    }

    function predictAddress(address owner, uint256 salt) external view returns (address) {
        return Clones.predictDeterministicAddress(address(implementation), _deploymentSalt(owner, salt));
    }

    function _deploymentSalt(address owner, uint256 salt) private pure returns (bytes32) {
        return keccak256(abi.encode(owner, salt));
    }
}
