pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import {IERC1155Receiver} from "@openzeppelin/contracts/token/ERC1155/IERC1155Receiver.sol";
import {IERC4626} from "@openzeppelin/contracts/interfaces/IERC4626.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {Address} from "@openzeppelin/contracts/utils/Address.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {ProtocolConfig} from "./ProtocolConfig.sol";
import {EarlyUnlockFee} from "./libraries/EarlyUnlockFee.sol";
import {IWrappedNative} from "./interfaces/IWrappedNative.sol";

contract LockableAccount is IERC721Receiver, IERC1155Receiver, ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum LockStatus {
        None,
        Active,
        EarlyUnlocked,
        Completed
    }

    struct WalletLock {
        uint64 start;
        uint64 end;
        uint64 closedAt;
        uint16 minFeeBps;
        uint16 maxFeeBps;
        uint16 feeBpsPaid;
        uint32 feeAssetListVersion;
        bool staked;
        LockStatus status;
    }

    struct Call {
        address target;
        uint256 value;
        bytes data;
    }

    struct StakeInstruction {
        address token;
        address vault;
        uint256 amount;
    }

    enum ApprovalKind {
        Erc20Allowance,
        Erc721Token,
        OperatorForAll,
        Erc777Operator,
        Erc6909Operator,
        Erc6909Allowance
    }

    struct TrackedApproval {
        address token;
        ApprovalKind kind;
        address spender;
        uint256 id;
    }

    uint256 public constant PROTOCOL_VERSION = 3;
    uint256 public constant MAX_TRACKED_APPROVALS = 64;
    uint64 public constant MIN_RECOVERY_DELAY = 2 days;
    uint64 public constant MAX_RECOVERY_DELAY = 90 days;
    bytes4 public constant ERC1271_INVALID = 0xffffffff;

    uint256 private constant PROBE_GAS = 100_000;
    uint256 private constant MAX_MULTICALL_DEPTH = 2;

    bytes4 private constant APPROVE = 0x095ea7b3;
    bytes4 private constant INCREASE_ALLOWANCE = bytes4(keccak256("increaseAllowance(address,uint256)"));
    bytes4 private constant DECREASE_ALLOWANCE = bytes4(keccak256("decreaseAllowance(address,uint256)"));
    bytes4 private constant INCREASE_APPROVAL = bytes4(keccak256("increaseApproval(address,uint256)"));
    bytes4 private constant DECREASE_APPROVAL = bytes4(keccak256("decreaseApproval(address,uint256)"));
    bytes4 private constant APPROVE_AND_CALL = bytes4(keccak256("approveAndCall(address,uint256)"));
    bytes4 private constant APPROVE_AND_CALL_DATA = bytes4(keccak256("approveAndCall(address,uint256,bytes)"));
    bytes4 private constant SET_APPROVAL_FOR_ALL = bytes4(keccak256("setApprovalForAll(address,bool)"));
    bytes4 private constant AUTHORIZE_OPERATOR = bytes4(keccak256("authorizeOperator(address)"));
    bytes4 private constant REVOKE_OPERATOR = bytes4(keccak256("revokeOperator(address)"));
    bytes4 private constant SET_OPERATOR_6909 = bytes4(keccak256("setOperator(address,bool)"));
    bytes4 private constant APPROVE_6909 = bytes4(keccak256("approve(address,uint256,uint256)"));
    bytes4 private constant MULTICALL = bytes4(keccak256("multicall(bytes[])"));
    bytes4 private constant MULTICALL_DEADLINE = bytes4(keccak256("multicall(uint256,bytes[])"));
    bytes4 private constant MULTICALL_BLOCKHASH = bytes4(keccak256("multicall(bytes32,bytes[])"));

    ProtocolConfig public immutable config;
    address public immutable factory;
    address private immutable _wrappedNative;

    address public owner;
    address public pendingOwner;

    address public recoveryAddress;
    uint64 public recoveryDelay;
    address public pendingRecoveryOwner;
    uint64 public recoveryExecutableAt;

    WalletLock[] private _locks;

    bytes32[] private _approvalKeys;
    mapping(bytes32 key => uint256 indexPlusOne) private _approvalIndex;
    mapping(bytes32 key => TrackedApproval) private _approvals;

    event Initialized(address indexed owner);
    event Executed(address indexed target, uint256 value, bytes4 selector);
    event WalletLocked(
        uint256 indexed lockIndex,
        uint64 start,
        uint64 end,
        uint16 minFeeBps,
        uint16 maxFeeBps,
        uint256 feeAssetListVersion
    );
    event Staked(uint256 indexed lockIndex, address indexed token, address indexed vault, uint256 assets, uint256 shares);
    event WalletUnlockedEarly(uint256 indexed lockIndex, uint256 feeBps);
    event EarlyUnlockFeePaid(uint256 indexed lockIndex, address indexed asset, uint256 amount, address treasury);
    event WalletLockCompleted(uint256 indexed lockIndex);
    event ApprovalTracked(address indexed token, address indexed spender, ApprovalKind kind, uint256 id);
    event ApprovalCleared(address indexed token, address indexed spender, ApprovalKind kind, uint256 id);
    event OwnershipTransferStarted(address indexed previousOwner, address indexed newOwner);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event RecoveryConfigured(address indexed recoveryAddress, uint64 delay);
    event RecoveryInitiated(address indexed newOwner, uint64 executableAt);
    event RecoveryCancelled();

    error NotOwner();
    error NotFactory();
    error AlreadyInitialized();
    error ZeroAddress();
    error WalletIsLocked(uint64 unlockTime);
    error WalletNotLocked();
    error NoActiveLock();
    error SelfCallForbidden();
    error ApprovalStillActive(address token, address spender, ApprovalKind kind, uint256 id);
    error TooManyTrackedApprovals();
    error InvalidStake(address token, address vault);
    error FeeTermsChanged(uint256 minFee, uint256 maxFee);
    error FeeAssetListChanged(uint256 expectedVersion, uint256 currentVersion);
    error ZeroShares();
    error NotPendingOwner();
    error NotRecoveryAddress();
    error InvalidRecoveryDelay(uint64 delay);
    error NoPendingRecovery();
    error RecoveryNotReady(uint64 executableAt);

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier whenUnlocked() {
        _requireUnlocked();
        _;
    }

    constructor(ProtocolConfig config_) {
        config = config_;
        factory = msg.sender;
        _wrappedNative = config_.wrappedNative();
        owner = address(0xdead);
    }

    function initialize(address owner_) external {
        if (msg.sender != factory) revert NotFactory();
        if (owner != address(0)) revert AlreadyInitialized();
        if (owner_ == address(0)) revert ZeroAddress();
        owner = owner_;
        emit Initialized(owner_);
        emit OwnershipTransferred(address(0), owner_);
    }

    receive() external payable {}

    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        return IERC721Receiver.onERC721Received.selector;
    }

    function onERC1155Received(address, address, uint256, uint256, bytes calldata) external pure returns (bytes4) {
        return IERC1155Receiver.onERC1155Received.selector;
    }

    function onERC1155BatchReceived(address, address, uint256[] calldata, uint256[] calldata, bytes calldata)
        external
        pure
        returns (bytes4)
    {
        return IERC1155Receiver.onERC1155BatchReceived.selector;
    }

    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return interfaceId == type(IERC165).interfaceId || interfaceId == type(IERC721Receiver).interfaceId
            || interfaceId == type(IERC1155Receiver).interfaceId;
    }

    function isValidSignature(bytes32, bytes calldata) external pure returns (bytes4) {
        return ERC1271_INVALID;
    }

    function execute(address target, uint256 value, bytes calldata data)
        external
        payable
        onlyOwner
        whenUnlocked
        nonReentrant
        returns (bytes memory result)
    {
        result = _call(target, value, data);
    }

    function executeBatch(Call[] calldata calls)
        external
        payable
        onlyOwner
        whenUnlocked
        nonReentrant
        returns (bytes[] memory results)
    {
        results = new bytes[](calls.length);
        for (uint256 i; i < calls.length; ++i) {
            results[i] = _call(calls[i].target, calls[i].value, calls[i].data);
        }
    }

    function lock(
        uint64 unlockTime,
        StakeInstruction[] calldata stakes,
        uint16 acceptedMinFeeBps,
        uint16 acceptedMaxFeeBps,
        uint256 feeAssetListVersion
    ) external payable onlyOwner whenUnlocked nonReentrant returns (uint256 lockIndex) {
        config.checkUnlockTime(unlockTime);
        (uint16 minFeeBps, uint16 maxFeeBps) = config.earlyUnlockFeeTerms();
        if (minFeeBps > acceptedMinFeeBps || maxFeeBps > acceptedMaxFeeBps) {
            revert FeeTermsChanged(minFeeBps, maxFeeBps);
        }
        uint256 currentVersion = config.currentFeeAssetListVersion();
        if (currentVersion != feeAssetListVersion) revert FeeAssetListChanged(feeAssetListVersion, currentVersion);
        _closeMaturedLock();

        lockIndex = _locks.length;
        for (uint256 i; i < stakes.length; ++i) {
            _stake(lockIndex, stakes[i]);
        }
        _verifyNoActiveApproval();

        WalletLock storage l = _locks.push();
        l.start = uint64(block.timestamp);
        l.end = unlockTime;
        l.minFeeBps = minFeeBps;
        l.maxFeeBps = maxFeeBps;
        l.feeAssetListVersion = uint32(currentVersion);
        l.staked = stakes.length != 0;
        l.status = LockStatus.Active;
        emit WalletLocked(lockIndex, l.start, l.end, l.minFeeBps, l.maxFeeBps, l.feeAssetListVersion);
    }

    function unlockEarly() external onlyOwner nonReentrant returns (uint256 feeBps) {
        (bool locked, uint256 index) = _currentLock();
        if (!locked) revert WalletNotLocked();
        WalletLock storage l = _locks[index];

        feeBps = EarlyUnlockFee.feeBps(l.minFeeBps, l.maxFeeBps, l.start, l.end, block.timestamp);
        l.status = LockStatus.EarlyUnlocked;
        l.closedAt = uint64(block.timestamp);
        l.feeBpsPaid = uint16(feeBps);

        address treasury = config.treasury();
        uint256 nativeFee = EarlyUnlockFee.feeAmount(address(this).balance, feeBps);
        if (nativeFee != 0) {
            Address.sendValue(payable(treasury), nativeFee);
            emit EarlyUnlockFeePaid(index, address(0), nativeFee, treasury);
        }

        address[] memory assets = config.feeAssets(l.feeAssetListVersion);
        for (uint256 i; i < assets.length; ++i) {
            IERC20 asset = IERC20(assets[i]);
            uint256 fee = EarlyUnlockFee.feeAmount(asset.balanceOf(address(this)), feeBps);
            if (fee != 0) {
                asset.safeTransfer(treasury, fee);
                emit EarlyUnlockFeePaid(index, address(asset), fee, treasury);
            }
        }
        emit WalletUnlockedEarly(index, feeBps);
    }

    function completeLock() external onlyOwner {
        uint256 count = _locks.length;
        if (count == 0 || _locks[count - 1].status != LockStatus.Active) revert NoActiveLock();
        WalletLock storage l = _locks[count - 1];
        if (block.timestamp < l.end) revert WalletIsLocked(l.end);
        l.status = LockStatus.Completed;
        l.closedAt = l.end;
        emit WalletLockCompleted(count - 1);
    }

    function pruneApprovals() external onlyOwner {
        _pruneInactiveApprovals();
    }

    function transferOwnership(address newOwner) external onlyOwner whenUnlocked {
        if (newOwner == address(0)) revert ZeroAddress();
        pendingOwner = newOwner;
        emit OwnershipTransferStarted(owner, newOwner);
    }

    function acceptOwnership() external whenUnlocked {
        if (msg.sender != pendingOwner) revert NotPendingOwner();
        _transferOwnership(msg.sender);
    }

    function setRecovery(address recovery, uint64 delay) external onlyOwner whenUnlocked {
        if (recovery == address(0)) {
            delay = 0;
        } else if (delay < MIN_RECOVERY_DELAY || delay > MAX_RECOVERY_DELAY) {
            revert InvalidRecoveryDelay(delay);
        }
        recoveryAddress = recovery;
        recoveryDelay = delay;
        _clearPendingRecovery();
        emit RecoveryConfigured(recovery, delay);
    }

    function initiateRecovery(address newOwner) external {
        if (recoveryAddress == address(0) || msg.sender != recoveryAddress) revert NotRecoveryAddress();
        if (newOwner == address(0)) revert ZeroAddress();
        pendingRecoveryOwner = newOwner;
        recoveryExecutableAt = uint64(block.timestamp) + recoveryDelay;
        emit RecoveryInitiated(newOwner, recoveryExecutableAt);
    }

    function cancelRecovery() external onlyOwner {
        if (pendingRecoveryOwner == address(0)) revert NoPendingRecovery();
        _clearPendingRecovery();
        emit RecoveryCancelled();
    }

    function completeRecovery() external {
        address newOwner = pendingRecoveryOwner;
        if (newOwner == address(0)) revert NoPendingRecovery();
        if (block.timestamp < recoveryExecutableAt) revert RecoveryNotReady(recoveryExecutableAt);
        _clearPendingRecovery();
        _transferOwnership(newOwner);
    }

    function isLocked() public view returns (bool locked) {
        (locked,) = _currentLock();
    }

    function lockedUntil() external view returns (uint64) {
        (bool locked, uint256 index) = _currentLock();
        return locked ? _locks[index].end : 0;
    }

    function lockCount() external view returns (uint256) {
        return _locks.length;
    }

    function getLocks() external view returns (WalletLock[] memory locks) {
        locks = _locks;
        for (uint256 i; i < locks.length; ++i) {
            if (locks[i].status == LockStatus.Active && block.timestamp >= locks[i].end) {
                locks[i].status = LockStatus.Completed;
                locks[i].closedAt = locks[i].end;
            }
        }
    }

    function previewEarlyUnlock()
        external
        view
        returns (uint256 feeBps, address[] memory assets, uint256[] memory balances, uint256[] memory fees)
    {
        (bool locked, uint256 index) = _currentLock();
        if (!locked) return (0, new address[](0), new uint256[](0), new uint256[](0));
        WalletLock storage l = _locks[index];
        feeBps = EarlyUnlockFee.feeBps(l.minFeeBps, l.maxFeeBps, l.start, l.end, block.timestamp);

        address[] memory listed = config.feeAssets(l.feeAssetListVersion);
        uint256 count = listed.length + 1;
        assets = new address[](count);
        balances = new uint256[](count);
        fees = new uint256[](count);

        balances[0] = address(this).balance;
        fees[0] = EarlyUnlockFee.feeAmount(balances[0], feeBps);
        for (uint256 i; i < listed.length; ++i) {
            assets[i + 1] = listed[i];
            balances[i + 1] = IERC20(listed[i]).balanceOf(address(this));
            fees[i + 1] = EarlyUnlockFee.feeAmount(balances[i + 1], feeBps);
        }
    }

    function trackedApprovals() external view returns (TrackedApproval[] memory approvals, bool[] memory live) {
        uint256 count = _approvalKeys.length;
        approvals = new TrackedApproval[](count);
        live = new bool[](count);
        for (uint256 i; i < count; ++i) {
            TrackedApproval memory a = _approvals[_approvalKeys[i]];
            approvals[i] = a;
            live[i] = _isApprovalLive(a.token, a.spender, a.kind, a.id);
        }
    }

    function _requireUnlocked() private view {
        (bool locked, uint256 index) = _currentLock();
        if (locked) revert WalletIsLocked(_locks[index].end);
    }

    function _currentLock() private view returns (bool locked, uint256 index) {
        uint256 count = _locks.length;
        if (count == 0) return (false, 0);
        index = count - 1;
        WalletLock storage l = _locks[index];
        locked = l.status == LockStatus.Active && block.timestamp < l.end;
    }

    function _closeMaturedLock() private {
        uint256 count = _locks.length;
        if (count == 0) return;
        WalletLock storage l = _locks[count - 1];
        if (l.status == LockStatus.Active) {
            l.status = LockStatus.Completed;
            l.closedAt = l.end;
            emit WalletLockCompleted(count - 1);
        }
    }

    function _call(address target, uint256 value, bytes calldata data) private returns (bytes memory result) {
        if (target == address(this)) revert SelfCallForbidden();
        (bool success, bytes memory returndata) = target.call{value: value}(data);
        result = Address.verifyCallResult(success, returndata);
        bytes4 selector;
        if (data.length >= 4) {
            selector = bytes4(data[:4]);
            if (_isInspected(selector)) _trackApproval(target, data, 0);
        }
        emit Executed(target, value, selector);
    }

    function _stake(uint256 lockIndex, StakeInstruction calldata s) private {
        if (s.amount == 0 || s.vault == address(0) || config.stakingVaultOf(s.token) != s.vault) {
            revert InvalidStake(s.token, s.vault);
        }
        address asset = s.token;
        if (asset == address(0)) {
            asset = _wrappedNative;
            IWrappedNative(asset).deposit{value: s.amount}();
        }
        IERC20(asset).forceApprove(s.vault, s.amount);
        uint256 shares = IERC4626(s.vault).deposit(s.amount, address(this));
        IERC20(asset).forceApprove(s.vault, 0);
        if (shares == 0) revert ZeroShares();
        emit Staked(lockIndex, s.token, s.vault, s.amount, shares);
    }

    function _isErc20StyleApproval(bytes4 selector) private pure returns (bool) {
        return selector == APPROVE || selector == INCREASE_ALLOWANCE || selector == DECREASE_ALLOWANCE
            || selector == INCREASE_APPROVAL || selector == DECREASE_APPROVAL || selector == APPROVE_AND_CALL
            || selector == APPROVE_AND_CALL_DATA;
    }

    function _isMulticall(bytes4 selector) private pure returns (bool) {
        return selector == MULTICALL || selector == MULTICALL_DEADLINE || selector == MULTICALL_BLOCKHASH;
    }

    function _isInspected(bytes4 selector) private pure returns (bool) {
        return _isErc20StyleApproval(selector) || _isMulticall(selector) || selector == SET_APPROVAL_FOR_ALL
            || selector == SET_OPERATOR_6909 || selector == APPROVE_6909 || selector == AUTHORIZE_OPERATOR
            || selector == REVOKE_OPERATOR;
    }

    function _trackApproval(address token, bytes memory data, uint256 depth) private {
        if (data.length < 4) return;
        bytes4 selector = bytes4(data);
        if (_isErc20StyleApproval(selector)) {
            if (data.length < 68) return;
            address spender = address(uint160(_arg(data, 0)));
            if (spender == address(0)) return;
            _refreshApproval(token, spender, ApprovalKind.Erc20Allowance, 0);
            if (selector == APPROVE) _refreshApproval(token, spender, ApprovalKind.Erc721Token, _arg(data, 1));
        } else if (selector == SET_APPROVAL_FOR_ALL || selector == SET_OPERATOR_6909) {
            if (data.length < 68) return;
            ApprovalKind kind = selector == SET_APPROVAL_FOR_ALL ? ApprovalKind.OperatorForAll : ApprovalKind.Erc6909Operator;
            _refreshApproval(token, address(uint160(_arg(data, 0))), kind, 0);
        } else if (selector == APPROVE_6909) {
            if (data.length < 100) return;
            _refreshApproval(token, address(uint160(_arg(data, 0))), ApprovalKind.Erc6909Allowance, _arg(data, 1));
        } else if (selector == AUTHORIZE_OPERATOR || selector == REVOKE_OPERATOR) {
            if (data.length < 36) return;
            _refreshApproval(token, address(uint160(_arg(data, 0))), ApprovalKind.Erc777Operator, 0);
        } else if (_isMulticall(selector) && depth < MAX_MULTICALL_DEPTH) {
            bytes memory args = _stripSelector(data);
            bytes[] memory calls;
            if (selector == MULTICALL) calls = abi.decode(args, (bytes[]));
            else (, calls) = abi.decode(args, (uint256, bytes[]));
            for (uint256 i; i < calls.length; ++i) {
                _trackApproval(token, calls[i], depth + 1);
            }
        }
    }

    function _arg(bytes memory data, uint256 index) private pure returns (uint256 word) {
        assembly ("memory-safe") {
            word := mload(add(add(data, 36), shl(5, index)))
        }
    }

    function _stripSelector(bytes memory data) private pure returns (bytes memory args) {
        uint256 length = data.length - 4;
        args = new bytes(length);
        assembly ("memory-safe") {
            let src := add(data, 36)
            let dst := add(args, 32)
            for { let i := 0 } lt(i, length) { i := add(i, 32) } { mstore(add(dst, i), mload(add(src, i))) }
        }
    }

    function _refreshApproval(address token, address spender, ApprovalKind kind, uint256 id) private {
        bytes32 key = keccak256(abi.encode(token, spender, kind, id));
        if (_isApprovalLive(token, spender, kind, id)) {
            if (_addApprovalKey(key)) {
                _approvals[key] = TrackedApproval({token: token, kind: kind, spender: spender, id: id});
                emit ApprovalTracked(token, spender, kind, id);
                if (_approvalKeys.length > MAX_TRACKED_APPROVALS) {
                    _pruneInactiveApprovals();
                    if (_approvalKeys.length > MAX_TRACKED_APPROVALS) revert TooManyTrackedApprovals();
                }
            }
        } else if (_removeApprovalKey(key)) {
            delete _approvals[key];
            emit ApprovalCleared(token, spender, kind, id);
        }
    }

    function _addApprovalKey(bytes32 key) private returns (bool) {
        if (_approvalIndex[key] != 0) return false;
        _approvalKeys.push(key);
        _approvalIndex[key] = _approvalKeys.length;
        return true;
    }

    function _removeApprovalKey(bytes32 key) private returns (bool) {
        uint256 indexPlusOne = _approvalIndex[key];
        if (indexPlusOne == 0) return false;
        uint256 lastIndexPlusOne = _approvalKeys.length;
        if (indexPlusOne != lastIndexPlusOne) {
            bytes32 moved = _approvalKeys[lastIndexPlusOne - 1];
            _approvalKeys[indexPlusOne - 1] = moved;
            _approvalIndex[moved] = indexPlusOne;
        }
        _approvalKeys.pop();
        delete _approvalIndex[key];
        return true;
    }

    function _verifyNoActiveApproval() private {
        for (uint256 i = _approvalKeys.length; i > 0; --i) {
            bytes32 key = _approvalKeys[i - 1];
            TrackedApproval memory a = _approvals[key];
            if (_isApprovalLive(a.token, a.spender, a.kind, a.id)) {
                revert ApprovalStillActive(a.token, a.spender, a.kind, a.id);
            }
            _removeApprovalKey(key);
            delete _approvals[key];
            emit ApprovalCleared(a.token, a.spender, a.kind, a.id);
        }
    }

    function _pruneInactiveApprovals() private {
        for (uint256 i = _approvalKeys.length; i > 0; --i) {
            bytes32 key = _approvalKeys[i - 1];
            TrackedApproval memory a = _approvals[key];
            if (!_isApprovalLive(a.token, a.spender, a.kind, a.id)) {
                _removeApprovalKey(key);
                delete _approvals[key];
                emit ApprovalCleared(a.token, a.spender, a.kind, a.id);
            }
        }
    }

    function _isApprovalLive(address token, address spender, ApprovalKind kind, uint256 id)
        private
        view
        returns (bool)
    {
        bool ok;
        uint256 value;
        if (kind == ApprovalKind.Erc20Allowance) {
            (ok, value) = _probe(token, abi.encodeCall(IERC20.allowance, (address(this), spender)));
            return ok && value != 0;
        }
        if (kind == ApprovalKind.Erc721Token) {
            (ok, value) = _probe(token, abi.encodeCall(IERC721.getApproved, (id)));
            return ok && value == uint256(uint160(spender));
        }
        if (kind == ApprovalKind.OperatorForAll) {
            (ok, value) = _probe(token, abi.encodeCall(IERC721.isApprovedForAll, (address(this), spender)));
            return ok && value != 0;
        }
        if (kind == ApprovalKind.Erc777Operator) {
            (ok, value) = _probe(token, abi.encodeWithSignature("isOperatorFor(address,address)", spender, address(this)));
            return ok && value != 0;
        }
        if (kind == ApprovalKind.Erc6909Operator) {
            (ok, value) = _probe(token, abi.encodeWithSignature("isOperator(address,address)", address(this), spender));
            return ok && value != 0;
        }
        (ok, value) = _probe(
            token, abi.encodeWithSignature("allowance(address,address,uint256)", address(this), spender, id)
        );
        return ok && value != 0;
    }

    function _probe(address target, bytes memory callData) private view returns (bool ok, uint256 value) {
        if (target.code.length == 0) return (false, 0);
        (bool success, bytes memory ret) = target.staticcall{gas: PROBE_GAS}(callData);
        if (!success || ret.length < 32) return (false, 0);
        return (true, abi.decode(ret, (uint256)));
    }

    function _transferOwnership(address newOwner) private {
        address previous = owner;
        owner = newOwner;
        delete pendingOwner;
        emit OwnershipTransferred(previous, newOwner);
    }

    function _clearPendingRecovery() private {
        delete pendingRecoveryOwner;
        delete recoveryExecutableAt;
    }
}
