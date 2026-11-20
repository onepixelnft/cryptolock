// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC4626} from "@openzeppelin/contracts/interfaces/IERC4626.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {Address} from "@openzeppelin/contracts/utils/Address.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

import {ProtocolConfig} from "./ProtocolConfig.sol";
import {EarlyUnlockFee} from "./libraries/EarlyUnlockFee.sol";
import {IWrappedNative} from "./interfaces/IWrappedNative.sol";

contract LockVault is ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    uint256 public constant PROTOCOL_VERSION = 3;

    address public constant NATIVE = address(0);

    uint256 private constant VIRTUAL_POOL_SHARES = 1e6;

    enum Status {
        None,
        Active,
        Withdrawn,
        EarlyUnlocked,
        WithdrawnAsShares
    }

    struct Lock {
        address owner;
        uint64 start;
        uint16 minFeeBps;
        uint16 maxFeeBps;
        address token;
        uint64 end;
        Status status;
        address vault;
        uint64 closedAt;
        uint256 amount;
        uint256 shares;
        uint256 fee;
        uint256 amountOut;
    }

    ProtocolConfig public immutable config;
    address public immutable wrappedNative;

    address public immutable nativeTokenAlias;

    uint256 public lockCount;

    mapping(uint256 lockId => Lock) private _locks;
    mapping(address owner => uint256[]) private _lockIds;

    mapping(address token => uint256) public totalPrincipalLocked;
    mapping(address token => uint256) public totalPoolShares;
    mapping(address vault => uint256) public totalSharesLocked;
    mapping(address token => uint256) public accruedFees;

    event Locked(
        uint256 indexed lockId,
        address indexed owner,
        address indexed token,
        uint256 amount,
        uint64 start,
        uint64 end,
        address vault,
        uint256 shares,
        uint16 minFeeBps,
        uint16 maxFeeBps
    );
    event Withdrawn(uint256 indexed lockId, address indexed owner, address indexed token, uint256 amountOut);
    event UnlockedEarly(
        uint256 indexed lockId,
        address indexed owner,
        address indexed token,
        uint256 grossAmount,
        uint256 feeBps,
        uint256 fee,
        uint256 amountOut
    );
    event SharesWithdrawn(uint256 indexed lockId, address indexed owner, address indexed vault, uint256 shares);
    event FeesClaimed(address indexed token, address indexed treasury, uint256 amount);

    error NotAdmin();
    error ZeroAmount();
    error InvalidNativeValue();
    error NativeTokenAlias();
    error UnknownLock(uint256 lockId);
    error NotLockOwner();
    error LockNotActive();
    error LockNotMatured(uint64 unlockTime);
    error LockMatured();
    error NotStaked();
    error StakingUnavailable(address token);
    error StakingVaultChanged(address expectedVault, address currentVault);
    error FeeTermsChanged(uint256 minFee, uint256 maxFee);
    error ZeroShares();
    error SlippageExceeded(uint256 amountOut, uint256 minAmountOut);
    error NothingToClaim();
    error UnexpectedNativeTransfer();

    modifier onlyAdmin() {
        if (msg.sender != config.owner()) revert NotAdmin();
        _;
    }

    constructor(ProtocolConfig config_, address nativeTokenAlias_) {
        config = config_;
        wrappedNative = config_.wrappedNative();
        nativeTokenAlias = nativeTokenAlias_;
    }

    receive() external payable {
        if (wrappedNative == address(0) || msg.sender != wrappedNative) revert UnexpectedNativeTransfer();
    }

    function lock(
        address token,
        uint256 amount,
        uint64 unlockTime,
        address vault,
        uint16 acceptedMinFeeBps,
        uint16 acceptedMaxFeeBps
    ) external payable nonReentrant whenNotPaused returns (uint256 lockId) {
        if (amount == 0) revert ZeroAmount();
        if (token != NATIVE && token == nativeTokenAlias) revert NativeTokenAlias();
        config.checkUnlockTime(unlockTime);
        (uint16 minFeeBps, uint16 maxFeeBps) = config.earlyUnlockFeeTerms();
        if (minFeeBps > acceptedMinFeeBps || maxFeeBps > acceptedMaxFeeBps) {
            revert FeeTermsChanged(minFeeBps, maxFeeBps);
        }

        (uint256 received, uint256 shares) = _deposit(token, amount, vault);

        lockId = ++lockCount;
        Lock storage l = _locks[lockId];
        l.owner = msg.sender;
        l.start = uint64(block.timestamp);
        l.minFeeBps = minFeeBps;
        l.maxFeeBps = maxFeeBps;
        l.token = token;
        l.end = unlockTime;
        l.status = Status.Active;
        l.vault = vault;
        l.amount = received;
        l.shares = shares;
        _lockIds[msg.sender].push(lockId);
        _emitLocked(lockId, l);
    }

    function withdraw(uint256 lockId) external nonReentrant returns (uint256 amountOut) {
        Lock storage l = _ownedActiveLock(lockId);
        if (block.timestamp < l.end) revert LockNotMatured(l.end);

        l.status = Status.Withdrawn;
        l.closedAt = uint64(block.timestamp);
        amountOut = _release(l);
        l.amountOut = amountOut;

        _send(l.token, l.owner, amountOut);
        emit Withdrawn(lockId, l.owner, l.token, amountOut);
    }

    function withdrawShares(uint256 lockId) external nonReentrant returns (uint256 shares) {
        Lock storage l = _ownedActiveLock(lockId);
        if (l.vault == address(0)) revert NotStaked();
        if (block.timestamp < l.end) revert LockNotMatured(l.end);

        l.status = Status.WithdrawnAsShares;
        l.closedAt = uint64(block.timestamp);
        shares = l.shares;
        totalSharesLocked[l.vault] -= shares;

        IERC20(l.vault).safeTransfer(l.owner, shares);
        emit SharesWithdrawn(lockId, l.owner, l.vault, shares);
    }

    function unlockEarly(uint256 lockId, uint256 minAmountOut) external nonReentrant returns (uint256 amountOut) {
        Lock storage l = _ownedActiveLock(lockId);
        if (block.timestamp >= l.end) revert LockMatured();

        uint256 feeBps = EarlyUnlockFee.feeBps(l.minFeeBps, l.maxFeeBps, l.start, l.end, block.timestamp);
        l.status = Status.EarlyUnlocked;
        l.closedAt = uint64(block.timestamp);

        uint256 gross = _release(l);
        uint256 fee = EarlyUnlockFee.feeAmount(gross, feeBps);
        amountOut = gross - fee;
        if (amountOut < minAmountOut) revert SlippageExceeded(amountOut, minAmountOut);

        l.fee = fee;
        l.amountOut = amountOut;
        accruedFees[l.token] += fee;

        _send(l.token, l.owner, amountOut);
        emit UnlockedEarly(lockId, l.owner, l.token, gross, feeBps, fee, amountOut);
    }

    function claimFees(address token) external nonReentrant returns (uint256 amount) {
        amount = accruedFees[token];
        if (amount == 0) revert NothingToClaim();
        accruedFees[token] = 0;
        address treasury = config.treasury();
        _send(token, treasury, amount);
        emit FeesClaimed(token, treasury, amount);
    }

    function pause() external onlyAdmin {
        _pause();
    }

    function unpause() external onlyAdmin {
        _unpause();
    }

    function getLock(uint256 lockId) external view returns (Lock memory) {
        return _locks[lockId];
    }

    function getLocks(uint256[] calldata lockIds) external view returns (Lock[] memory locks) {
        locks = new Lock[](lockIds.length);
        for (uint256 i; i < lockIds.length; ++i) {
            locks[i] = _locks[lockIds[i]];
        }
    }

    function lockIdsOf(address owner) external view returns (uint256[] memory) {
        return _lockIds[owner];
    }

    function poolBalance(address token) public view returns (uint256) {
        uint256 balance = IERC20(token).balanceOf(address(this));
        uint256 reserved = accruedFees[token] + totalSharesLocked[token];
        return balance > reserved ? balance - reserved : 0;
    }

    function currentValue(uint256 lockId) public view returns (uint256) {
        Lock storage l = _locks[lockId];
        if (l.status != Status.Active) return 0;
        if (l.vault != address(0)) return IERC4626(l.vault).previewRedeem(l.shares);
        if (l.token == NATIVE) return l.amount;
        return _poolValue(l.token, l.shares);
    }

    function previewEarlyUnlock(uint256 lockId)
        external
        view
        returns (uint256 grossAmount, uint256 feeBps, uint256 fee, uint256 amountOut)
    {
        Lock storage l = _locks[lockId];
        if (l.status != Status.Active) return (0, 0, 0, 0);
        grossAmount = currentValue(lockId);
        feeBps = EarlyUnlockFee.feeBps(l.minFeeBps, l.maxFeeBps, l.start, l.end, block.timestamp);
        fee = EarlyUnlockFee.feeAmount(grossAmount, feeBps);
        amountOut = grossAmount - fee;
    }

    function earlyUnlockFeeBpsAt(uint256 lockId, uint256 timestamp) external view returns (uint256) {
        Lock storage l = _locks[lockId];
        if (l.status == Status.None) revert UnknownLock(lockId);
        return EarlyUnlockFee.feeBps(l.minFeeBps, l.maxFeeBps, l.start, l.end, timestamp);
    }

    function _ownedActiveLock(uint256 lockId) private view returns (Lock storage l) {
        l = _locks[lockId];
        if (l.status == Status.None) revert UnknownLock(lockId);
        if (l.owner != msg.sender) revert NotLockOwner();
        if (l.status != Status.Active) revert LockNotActive();
    }

    function _checkStakingVault(address token, address vault) private view {
        address current = config.stakingVaultOf(token);
        if (current == address(0)) revert StakingUnavailable(token);
        if (current != vault) revert StakingVaultChanged(vault, current);
    }

    function _deposit(address token, uint256 amount, address vault) private returns (uint256 received, uint256 shares) {
        if (vault != address(0)) {
            _checkStakingVault(token, vault);
            received = _pull(token, amount);
            shares = _depositToVault(token, vault, received);
            totalSharesLocked[vault] += shares;
            return (received, shares);
        }
        if (token == NATIVE) {
            received = _pull(token, amount);
        } else {
            uint256 poolBefore = poolBalance(token);
            received = _pull(token, amount);
            shares = Math.mulDiv(received, totalPoolShares[token] + VIRTUAL_POOL_SHARES, poolBefore + 1);
            if (shares == 0) revert ZeroShares();
            totalPoolShares[token] += shares;
        }
        totalPrincipalLocked[token] += received;
    }

    function _poolValue(address token, uint256 shares) private view returns (uint256) {
        return Math.mulDiv(shares, poolBalance(token) + 1, totalPoolShares[token] + VIRTUAL_POOL_SHARES);
    }

    function _pull(address token, uint256 amount) private returns (uint256 received) {
        if (token == NATIVE) {
            if (msg.value != amount) revert InvalidNativeValue();
            return amount;
        }
        if (msg.value != 0) revert InvalidNativeValue();
        IERC20 erc20 = IERC20(token);
        uint256 balanceBefore = erc20.balanceOf(address(this));
        erc20.safeTransferFrom(msg.sender, address(this), amount);
        received = erc20.balanceOf(address(this)) - balanceBefore;
        if (received == 0) revert ZeroAmount();
    }

    function _emitLocked(uint256 lockId, Lock storage l) private {
        emit Locked(lockId, l.owner, l.token, l.amount, l.start, l.end, l.vault, l.shares, l.minFeeBps, l.maxFeeBps);
    }

    function _release(Lock storage l) private returns (uint256 amount) {
        if (l.vault == address(0)) {
            totalPrincipalLocked[l.token] -= l.amount;
            if (l.token == NATIVE) return l.amount;
            amount = _poolValue(l.token, l.shares);
            totalPoolShares[l.token] -= l.shares;
            return amount;
        }
        totalSharesLocked[l.vault] -= l.shares;
        address asset = l.token == NATIVE ? wrappedNative : l.token;
        uint256 balanceBefore = IERC20(asset).balanceOf(address(this));
        IERC4626(l.vault).redeem(l.shares, address(this), address(this));
        amount = IERC20(asset).balanceOf(address(this)) - balanceBefore;
        if (l.token == NATIVE) IWrappedNative(asset).withdraw(amount);
    }

    function _depositToVault(address token, address vault, uint256 assets) private returns (uint256 shares) {
        address asset = token;
        if (token == NATIVE) {
            asset = wrappedNative;
            IWrappedNative(asset).deposit{value: assets}();
        }
        IERC20(asset).forceApprove(vault, assets);
        shares = IERC4626(vault).deposit(assets, address(this));
        IERC20(asset).forceApprove(vault, 0);
        if (shares == 0) revert ZeroShares();
    }

    function _send(address token, address to, uint256 amount) private {
        if (amount == 0) return;
        if (token == NATIVE) {
            Address.sendValue(payable(to), amount);
        } else {
            IERC20(token).safeTransfer(to, amount);
        }
    }
}
