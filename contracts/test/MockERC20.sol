// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockERC20 is ERC20 {
    bool _returnFalseForNoReason;

    constructor() ERC20("mock", "MOCK") {}

    function mint(address _to, uint256 _amount) external {
        _mint(_to, _amount);
    }

    function mockReturn() external {
        _returnFalseForNoReason = true;
    }

    function transfer(address _to, uint256 _amount) public override returns (bool) {
        if (_returnFalseForNoReason) {
            return false;
        }
        return super.transfer(_to, _amount);
    }

    function transferFrom(address _from, address _to, uint256 _amount) public override returns (bool) {
        if (_returnFalseForNoReason) {
            return false;
        }
        return super.transferFrom(_from, _to, _amount);
    }
}
