// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract DemoERC20 is ERC20 {
    constructor() ERC20("dummy", "DEMO") {}

    function mint(address _to, uint256 _amount) external {
        _mint(_to, _amount);
    }
}
