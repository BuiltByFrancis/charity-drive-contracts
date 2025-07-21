// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract ExternalContract {
    error BlockedNativeReceiving();

    bool private _blocked;

    function toggleBlocked() external {
        _blocked = !_blocked;
    }

    function getBalance() external view returns (uint256) {
        return address(this).balance;
    }

    function call(address _target, bytes calldata _data) external payable {
        (bool success, bytes memory data) = _target.call{ value: msg.value }(_data);

        if (!success) {
            if (data.length > 0) {
                assembly {
                    revert(add(data, 32), mload(data))
                }
            } else {
                revert("Call failed with no reason");
            }
        }
    }

    receive() external payable {
        if (_blocked) {
            revert BlockedNativeReceiving();
        }
    }
}
