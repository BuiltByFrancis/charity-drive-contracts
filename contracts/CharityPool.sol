// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { WETH9 } from "./lib/WETH9.sol";

import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract CharityPool is Ownable {
    address payable private immutable _weth;

    // #######################################################################################

    error FailedToWrapEther();
    error AmountCannotBeZero();
    error FailedToUnwrapEther();
    error FailedToTransferEther();
    error TokenIsNotApproved(address token);
    error InsufficientBalance(uint256 available, uint256 required);

    event DonationReceived(address indexed donor, uint256 amount, address token);
    event DonationClaimed(address indexed recipient, uint256 amount, address token);
    event TokenApprovalChanged(address indexed token, bool approved);

    // #######################################################################################

    mapping(address => bool) private _approvedTokens;

    // #######################################################################################

    modifier onlyApprovedToken(address token_) {
        if (!_approvedTokens[token_]) {
            revert TokenIsNotApproved(token_);
        }
        _;
    }

    // #######################################################################################

    constructor(address payable weth_, address owner_) Ownable(owner_) {
        _weth = weth_;

        _setTokenApproval(weth_, true);
    }

    // #######################################################################################

    function WETH() external view returns (address) {
        return _weth;
    }

    function tokenBalance(IERC20 token_) external view returns (uint256) {
        return _getTokenBalance(token_);
    }

    function isTokenApproved(address token_) external view returns (bool) {
        return _approvedTokens[token_];
    }

    // #######################################################################################

    /// @notice Allows users to donate Ether to the charity pool.
    /// @param wrapped_ The amount of Ether which is already wrapped.
    /// @dev This function combines eth and weth.
    function donateEther(uint256 wrapped_) external payable {
        uint256 donated = _wrapEth() + _receiveToken(IERC20(_weth), msg.sender, wrapped_);

        if (donated == 0) revert AmountCannotBeZero();

        emit DonationReceived(msg.sender, donated, _weth);
    }

    /// @notice Allows users to donate ERC20 tokens to the charity pool.
    /// @param token_ The address of the ERC20 token to donate.
    /// @param amount_ The amount of tokens to donate.
    function donateToken(address token_, uint256 amount_) external onlyApprovedToken(token_) {
        if (amount_ == 0) revert AmountCannotBeZero();
        emit DonationReceived(msg.sender, _receiveToken(IERC20(token_), msg.sender, amount_), token_);
    }

    // #######################################################################################

    /// @notice Allows the owner to claim Ether from the charity pool.
    /// @param recipient_ The address to send the claimed Ether to.
    function claimEther(address recipient_) external onlyOwner {
        uint256 amount = _getTokenBalance(IERC20(_weth));

        if (amount == 0) revert AmountCannotBeZero();

        WETH9(_weth).withdraw(amount);
        _transferEth(recipient_, amount);

        emit DonationClaimed(recipient_, amount, _weth);
    }

    /// @notice Allows the owner to claim Ether from the charity pool.
    /// @param recipient_ The address to send the claimed Ether to.
    /// @param amount_ The amount of Ether to claim.
    function claimEtherPartial(address recipient_, uint256 amount_) external onlyOwner {
        if (amount_ == 0) revert AmountCannotBeZero();

        // Note: withdraw already checks for sufficient balance, potentially want a nicer error message.
        WETH9(_weth).withdraw(amount_);
        _transferEth(recipient_, amount_);

        emit DonationClaimed(recipient_, amount_, _weth);
    }

    /// @notice Allows the owner to claim ERC20 tokens from the charity pool.
    /// @param token_ The address of the ERC20 token to claim.
    /// @param recipient_ The address to send the claimed tokens to.
    function claimToken(address token_, address recipient_) external onlyOwner onlyApprovedToken(token_) {
        uint256 amount = _getTokenBalance(IERC20(token_));

        if (amount == 0) revert AmountCannotBeZero();

        SafeERC20.safeTransfer(IERC20(token_), recipient_, amount);
        emit DonationClaimed(recipient_, amount, token_);
    }

    /// @notice Allows the owner to claim ERC20 tokens from the charity pool.
    /// @param token_ The address of the ERC20 token to claim.
    /// @param recipient_ The address to send the claimed tokens to.
    function claimTokenPartial(
        address token_,
        address recipient_,
        uint256 amount_
    ) external onlyOwner onlyApprovedToken(token_) {
        if (amount_ == 0) revert AmountCannotBeZero();

        // Note: SafeERC20 already checks for sufficient balance.
        SafeERC20.safeTransfer(IERC20(token_), recipient_, amount_);

        emit DonationClaimed(recipient_, amount_, token_);
    }

    /// @notice Allows the owner to set approval for an ERC20 token.
    /// @param token_ The address of the ERC20 token to approve.
    /// @param approved_ Whether the token is approved or not.
    function setTokenApproval(address token_, bool approved_) external onlyOwner {
        _setTokenApproval(token_, approved_);
    }

    // Note: Choosing currently to omit a "rescue" function for other tokens,
    // as it is a security risk depending on who the owner is.

    // #######################################################################################

    receive() external payable {
        if (msg.sender != _weth) {
            if (msg.value == 0) revert AmountCannotBeZero();
            emit DonationReceived(msg.sender, _wrapEth(), _weth);
        }
    }

    // #######################################################################################

    function _getTokenBalance(IERC20 token_) internal view returns (uint256) {
        return token_.balanceOf(address(this));
    }

    function _receiveToken(IERC20 token_, address from_, uint256 amount_) private returns (uint256) {
        if (amount_ > 0) {
            SafeERC20.safeTransferFrom(token_, from_, address(this), amount_);
        }

        return amount_;
    }

    function _setTokenApproval(address token_, bool approved_) private {
        _approvedTokens[token_] = approved_;
        emit TokenApprovalChanged(token_, approved_);
    }

    function _transferEth(address to_, uint256 amount_) private {
        // Note: This will need a gas limit if the recipient can be "untrusted".
        (bool success, ) = to_.call{ value: amount_ }("");
        if (!success) {
            revert FailedToTransferEther();
        }
    }

    function _wrapEth() private returns (uint256) {
        if (msg.value > 0) {
            WETH9(_weth).deposit{ value: msg.value }();
        }

        return msg.value;
    }
}
