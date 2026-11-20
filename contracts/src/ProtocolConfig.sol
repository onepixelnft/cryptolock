// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {IERC4626} from "@openzeppelin/contracts/interfaces/IERC4626.sol";

contract ProtocolConfig is Ownable2Step {
    uint16 public constant MAX_FEE_CAP_BPS = 2_000;
    uint64 public constant MIN_DURATION_FLOOR = 1 minutes;
    uint64 public constant MAX_DURATION_CEILING = 7300 days;
    uint256 public constant MAX_FEE_ASSETS = 32;

    address public immutable wrappedNative;

    address public treasury;
    uint16 public minEarlyUnlockFeeBps;
    uint16 public maxEarlyUnlockFeeBps;
    uint64 public minLockDuration;
    uint64 public maxLockDuration;

    mapping(address token => address vault) public stakingVaultOf;

    address[][] private _feeAssetLists;

    event TreasuryUpdated(address indexed treasury);
    event EarlyUnlockFeeUpdated(uint16 minFeeBps, uint16 maxFeeBps);
    event LockDurationLimitsUpdated(uint64 minDuration, uint64 maxDuration);
    event StakingVaultUpdated(address indexed token, address indexed vault);
    event FeeAssetListPublished(uint256 indexed version, address[] assets);

    error ZeroAddress();
    error InvalidFeeRange(uint16 minFeeBps, uint16 maxFeeBps);
    error InvalidDurationRange(uint64 minDuration, uint64 maxDuration);
    error LockDurationOutOfRange(uint256 duration, uint256 minDuration, uint256 maxDuration);
    error NotAContract(address account);
    error WrappedNativeUnavailable();
    error VaultAssetMismatch(address vault, address expectedAsset, address actualAsset);
    error TooManyFeeAssets(uint256 count, uint256 max);
    error DuplicateFeeAsset(address asset);
    error UnknownFeeAssetList(uint256 version);

    constructor(
        address initialOwner,
        address treasury_,
        address wrappedNative_,
        uint16 minFeeBps_,
        uint16 maxFeeBps_,
        uint64 minDuration_,
        uint64 maxDuration_
    ) Ownable(initialOwner) {
        if (wrappedNative_ != address(0) && wrappedNative_.code.length == 0) revert NotAContract(wrappedNative_);
        wrappedNative = wrappedNative_;
        _setTreasury(treasury_);
        _setEarlyUnlockFee(minFeeBps_, maxFeeBps_);
        _setLockDurationLimits(minDuration_, maxDuration_);
        _feeAssetLists.push();
        emit FeeAssetListPublished(0, new address[](0));
    }

    function setTreasury(address treasury_) external onlyOwner {
        _setTreasury(treasury_);
    }

    function setEarlyUnlockFee(uint16 minFeeBps_, uint16 maxFeeBps_) external onlyOwner {
        _setEarlyUnlockFee(minFeeBps_, maxFeeBps_);
    }

    function setLockDurationLimits(uint64 minDuration_, uint64 maxDuration_) external onlyOwner {
        _setLockDurationLimits(minDuration_, maxDuration_);
    }

    function setStakingVault(address token, address vault) external onlyOwner {
        if (vault != address(0)) {
            if (vault.code.length == 0) revert NotAContract(vault);
            address expected = token;
            if (token == address(0)) {
                if (wrappedNative == address(0)) revert WrappedNativeUnavailable();
                expected = wrappedNative;
            }
            address actual = IERC4626(vault).asset();
            if (actual != expected) revert VaultAssetMismatch(vault, expected, actual);
        }
        stakingVaultOf[token] = vault;
        emit StakingVaultUpdated(token, vault);
    }

    function publishFeeAssetList(address[] calldata assets) external onlyOwner returns (uint256 version) {
        uint256 count = assets.length;
        if (count > MAX_FEE_ASSETS) revert TooManyFeeAssets(count, MAX_FEE_ASSETS);
        for (uint256 i; i < count; ++i) {
            address asset = assets[i];
            if (asset == address(0)) revert ZeroAddress();
            if (asset.code.length == 0) revert NotAContract(asset);
            for (uint256 j; j < i; ++j) {
                if (assets[j] == asset) revert DuplicateFeeAsset(asset);
            }
        }
        version = _feeAssetLists.length;
        _feeAssetLists.push(assets);
        emit FeeAssetListPublished(version, assets);
    }

    function checkUnlockTime(uint256 unlockTime) external view {
        uint256 duration = unlockTime > block.timestamp ? unlockTime - block.timestamp : 0;
        if (duration < minLockDuration || duration > maxLockDuration) {
            revert LockDurationOutOfRange(duration, minLockDuration, maxLockDuration);
        }
    }

    function earlyUnlockFeeTerms() external view returns (uint16 minFeeBps, uint16 maxFeeBps) {
        return (minEarlyUnlockFeeBps, maxEarlyUnlockFeeBps);
    }

    function currentFeeAssetListVersion() external view returns (uint256) {
        return _feeAssetLists.length - 1;
    }

    function feeAssets(uint256 version) external view returns (address[] memory) {
        if (version >= _feeAssetLists.length) revert UnknownFeeAssetList(version);
        return _feeAssetLists[version];
    }

    function _setTreasury(address treasury_) private {
        if (treasury_ == address(0)) revert ZeroAddress();
        treasury = treasury_;
        emit TreasuryUpdated(treasury_);
    }

    function _setEarlyUnlockFee(uint16 minFeeBps_, uint16 maxFeeBps_) private {
        if (minFeeBps_ > maxFeeBps_ || maxFeeBps_ > MAX_FEE_CAP_BPS) revert InvalidFeeRange(minFeeBps_, maxFeeBps_);
        minEarlyUnlockFeeBps = minFeeBps_;
        maxEarlyUnlockFeeBps = maxFeeBps_;
        emit EarlyUnlockFeeUpdated(minFeeBps_, maxFeeBps_);
    }

    function _setLockDurationLimits(uint64 minDuration_, uint64 maxDuration_) private {
        if (minDuration_ < MIN_DURATION_FLOOR || maxDuration_ > MAX_DURATION_CEILING || minDuration_ > maxDuration_) {
            revert InvalidDurationRange(minDuration_, maxDuration_);
        }
        minLockDuration = minDuration_;
        maxLockDuration = maxDuration_;
        emit LockDurationLimitsUpdated(minDuration_, maxDuration_);
    }
}
