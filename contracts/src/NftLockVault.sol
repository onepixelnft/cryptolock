// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IERC1155} from "@openzeppelin/contracts/token/ERC1155/IERC1155.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import {IERC1155Receiver} from "@openzeppelin/contracts/token/ERC1155/IERC1155Receiver.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {Address} from "@openzeppelin/contracts/utils/Address.sol";

import {ProtocolConfig} from "./ProtocolConfig.sol";
import {EarlyUnlockFee} from "./libraries/EarlyUnlockFee.sol";

contract NftLockVault is ReentrancyGuard, Pausable, IERC721Receiver, IERC1155Receiver {
    uint256 public constant PROTOCOL_VERSION = 3;

    enum Standard {
        ERC721,
        ERC1155
    }

    enum Status {
        None,
        Active,
        Withdrawn,
        EarlyUnlocked
    }

    struct NftLock {
        address owner;
        uint64 start;
        Standard standard;
        Status status;
        address collection;
        uint64 end;
        uint64 closedAt;
        uint256 tokenId;
        uint256 amount;
        uint256 minFee;
        uint256 maxFee;
        uint256 feePaid;
    }

    ProtocolConfig public immutable config;

    uint256 public minEarlyUnlockFee;
    uint256 public maxEarlyUnlockFee;

    uint256 public lockCount;
    uint256 public accruedFees;

    mapping(uint256 lockId => NftLock) private _locks;
    mapping(address owner => uint256[]) private _lockIds;

    address private _receivingFrom;

    event NftLocked(
        uint256 indexed lockId,
        address indexed owner,
        address indexed collection,
        Standard standard,
        uint256 tokenId,
        uint256 amount,
        uint64 start,
        uint64 end,
        uint256 minFee,
        uint256 maxFee
    );
    event NftWithdrawn(uint256 indexed lockId, address indexed owner, address indexed collection, uint256 tokenId, uint256 amount);
    event NftUnlockedEarly(
        uint256 indexed lockId, address indexed owner, address indexed collection, uint256 tokenId, uint256 amount, uint256 fee
    );
    event EarlyUnlockFeeUpdated(uint256 minFee, uint256 maxFee);
    event FeesClaimed(address indexed treasury, uint256 amount);

    error NotAdmin();
    error InvalidFeeRange(uint256 minFee, uint256 maxFee);
    error FeeTermsChanged(uint256 minFee, uint256 maxFee);
    error InvalidAmount();
    error TransferNotReceived();
    error UnknownLock(uint256 lockId);
    error NotLockOwner();
    error LockNotActive();
    error LockNotMatured(uint64 unlockTime);
    error LockMatured();
    error InsufficientFee(uint256 required, uint256 sent);
    error NothingToClaim();
    error DirectTransferRejected();

    modifier onlyAdmin() {
        if (msg.sender != config.owner()) revert NotAdmin();
        _;
    }

    constructor(ProtocolConfig config_, uint256 minFee_, uint256 maxFee_) {
        config = config_;
        _setEarlyUnlockFee(minFee_, maxFee_);
    }

    function lock(
        address collection,
        Standard standard,
        uint256 tokenId,
        uint256 amount,
        uint64 unlockTime,
        uint256 acceptedMinFee,
        uint256 acceptedMaxFee
    ) external nonReentrant whenNotPaused returns (uint256 lockId) {
        config.checkUnlockTime(unlockTime);
        if (minEarlyUnlockFee > acceptedMinFee || maxEarlyUnlockFee > acceptedMaxFee) {
            revert FeeTermsChanged(minEarlyUnlockFee, maxEarlyUnlockFee);
        }

        if (standard == Standard.ERC721) {
            if (amount != 1) revert InvalidAmount();
            IERC721(collection).transferFrom(msg.sender, address(this), tokenId);
            if (IERC721(collection).ownerOf(tokenId) != address(this)) revert TransferNotReceived();
        } else {
            if (amount == 0) revert InvalidAmount();
            uint256 balanceBefore = IERC1155(collection).balanceOf(address(this), tokenId);
            _receivingFrom = collection;
            IERC1155(collection).safeTransferFrom(msg.sender, address(this), tokenId, amount, "");
            _receivingFrom = address(0);
            if (IERC1155(collection).balanceOf(address(this), tokenId) - balanceBefore != amount) {
                revert TransferNotReceived();
            }
        }

        lockId = ++lockCount;
        NftLock storage l = _locks[lockId];
        l.owner = msg.sender;
        l.start = uint64(block.timestamp);
        l.standard = standard;
        l.status = Status.Active;
        l.collection = collection;
        l.end = unlockTime;
        l.tokenId = tokenId;
        l.amount = amount;
        l.minFee = minEarlyUnlockFee;
        l.maxFee = maxEarlyUnlockFee;
        _lockIds[msg.sender].push(lockId);
        _emitLocked(lockId, l);
    }

    function withdraw(uint256 lockId) external nonReentrant {
        NftLock storage l = _ownedActiveLock(lockId);
        if (block.timestamp < l.end) revert LockNotMatured(l.end);
        l.status = Status.Withdrawn;
        l.closedAt = uint64(block.timestamp);
        _release(l);
        emit NftWithdrawn(lockId, l.owner, l.collection, l.tokenId, l.amount);
    }

    function unlockEarly(uint256 lockId) external payable nonReentrant {
        NftLock storage l = _ownedActiveLock(lockId);
        if (block.timestamp >= l.end) revert LockMatured();
        uint256 fee = EarlyUnlockFee.feeBps(l.minFee, l.maxFee, l.start, l.end, block.timestamp);
        if (msg.value < fee) revert InsufficientFee(fee, msg.value);

        l.status = Status.EarlyUnlocked;
        l.closedAt = uint64(block.timestamp);
        l.feePaid = fee;
        accruedFees += fee;

        _release(l);
        uint256 refund = msg.value - fee;
        if (refund != 0) Address.sendValue(payable(msg.sender), refund);
        emit NftUnlockedEarly(lockId, l.owner, l.collection, l.tokenId, l.amount, fee);
    }

    function claimFees() external nonReentrant returns (uint256 amount) {
        amount = accruedFees;
        if (amount == 0) revert NothingToClaim();
        accruedFees = 0;
        address treasury = config.treasury();
        Address.sendValue(payable(treasury), amount);
        emit FeesClaimed(treasury, amount);
    }

    function setEarlyUnlockFee(uint256 minFee_, uint256 maxFee_) external onlyAdmin {
        _setEarlyUnlockFee(minFee_, maxFee_);
    }

    function pause() external onlyAdmin {
        _pause();
    }

    function unpause() external onlyAdmin {
        _unpause();
    }

    function getLock(uint256 lockId) external view returns (NftLock memory) {
        return _locks[lockId];
    }

    function getLocks(uint256[] calldata lockIds) external view returns (NftLock[] memory locks) {
        locks = new NftLock[](lockIds.length);
        for (uint256 i; i < lockIds.length; ++i) {
            locks[i] = _locks[lockIds[i]];
        }
    }

    function lockIdsOf(address owner) external view returns (uint256[] memory) {
        return _lockIds[owner];
    }

    function earlyUnlockFeeTerms() external view returns (uint256 minFee, uint256 maxFee) {
        return (minEarlyUnlockFee, maxEarlyUnlockFee);
    }

    function previewEarlyUnlock(uint256 lockId) external view returns (uint256 fee) {
        NftLock storage l = _locks[lockId];
        if (l.status != Status.Active) return 0;
        return EarlyUnlockFee.feeBps(l.minFee, l.maxFee, l.start, l.end, block.timestamp);
    }

    function earlyUnlockFeeAt(uint256 lockId, uint256 timestamp) external view returns (uint256) {
        NftLock storage l = _locks[lockId];
        if (l.status == Status.None) revert UnknownLock(lockId);
        return EarlyUnlockFee.feeBps(l.minFee, l.maxFee, l.start, l.end, timestamp);
    }

    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        revert DirectTransferRejected();
    }

    function onERC1155Received(address operator, address, uint256, uint256, bytes calldata)
        external
        view
        returns (bytes4)
    {
        if (operator != address(this) || msg.sender != _receivingFrom) revert DirectTransferRejected();
        return IERC1155Receiver.onERC1155Received.selector;
    }

    function onERC1155BatchReceived(address, address, uint256[] calldata, uint256[] calldata, bytes calldata)
        external
        pure
        returns (bytes4)
    {
        revert DirectTransferRejected();
    }

    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return interfaceId == type(IERC165).interfaceId || interfaceId == type(IERC1155Receiver).interfaceId
            || interfaceId == type(IERC721Receiver).interfaceId;
    }

    function _ownedActiveLock(uint256 lockId) private view returns (NftLock storage l) {
        l = _locks[lockId];
        if (l.status == Status.None) revert UnknownLock(lockId);
        if (l.owner != msg.sender) revert NotLockOwner();
        if (l.status != Status.Active) revert LockNotActive();
    }

    function _emitLocked(uint256 lockId, NftLock storage l) private {
        emit NftLocked(
            lockId, l.owner, l.collection, l.standard, l.tokenId, l.amount, l.start, l.end, l.minFee, l.maxFee
        );
    }

    function _release(NftLock storage l) private {
        if (l.standard == Standard.ERC721) {
            IERC721(l.collection).transferFrom(address(this), l.owner, l.tokenId);
        } else {
            IERC1155(l.collection).safeTransferFrom(address(this), l.owner, l.tokenId, l.amount, "");
        }
    }

    function _setEarlyUnlockFee(uint256 minFee_, uint256 maxFee_) private {
        if (minFee_ > maxFee_) revert InvalidFeeRange(minFee_, maxFee_);
        minEarlyUnlockFee = minFee_;
        maxEarlyUnlockFee = maxFee_;
        emit EarlyUnlockFeeUpdated(minFee_, maxFee_);
    }
}
