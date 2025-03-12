// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.20;
pragma abicoder v2;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";

interface ISushiBar {
    function enter(uint256 _amount) external;

    function leave(uint256 _share) external;

    function balanceOf(address account) external view returns (uint256);

    function totalSupply() external view returns (uint256);
}

interface ISwapRouter {
    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 deadline;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }

    function exactInputSingle(
        ExactInputSingleParams calldata params
    ) external returns (uint256 amountOut);
}

contract XSushiVault is ERC4626, ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public immutable sushi;
    ISushiBar public immutable sushiBar;
    ISwapRouter public immutable router;
    IERC20 public immutable xSushi;

    constructor(
        IERC20Metadata _sushi,
        ISushiBar _sushiBar,
        ISwapRouter _router,
        IERC20 _xSushi
    ) ERC4626(_sushi) ERC20("xSushi Vault", "vxSushi") {
        sushi = _sushi;
        sushiBar = _sushiBar;
        router = _router;
        xSushi = _xSushi;
    }

    function totalAssets() public view override returns (uint256) {
        uint256 xSushiBalance = xSushi.balanceOf(address(this));
        if (xSushiBalance == 0) return 0;
        uint256 totalSushiInBar = sushi.balanceOf(address(sushiBar));
        uint256 totalxSushi = xSushi.totalSupply();
        return (xSushiBalance * totalSushiInBar) / totalxSushi;
    }

    function _deposit(
        address caller,
        address receiver,
        uint256 assets,
        uint256 shares
    ) internal override nonReentrant {
        SafeERC20.safeTransferFrom(sushi, caller, address(this), assets);
        sushi.approve(address(sushiBar), assets);
        sushiBar.enter(assets);
        _mint(receiver, shares);
        emit Deposit(caller, receiver, assets, shares);
    }

    function _withdraw(
        address caller,
        address receiver,
        address owner,
        uint256 assets,
        uint256 shares
    ) internal override nonReentrant {
        if (caller != owner) {
            _spendAllowance(owner, caller, shares);
        }
        _burn(owner, shares);
        uint256 totalSushiInBar = sushi.balanceOf(address(sushiBar));
        uint256 totalxSushi = xSushi.totalSupply();
        uint256 xSushiToLeave = Math.ceilDiv(
            assets * totalxSushi,
            totalSushiInBar
        );
        xSushi.approve(address(sushiBar), xSushiToLeave);
        sushiBar.leave(xSushiToLeave);
        SafeERC20.safeTransfer(sushi, receiver, assets);
        emit Withdraw(caller, receiver, owner, assets, shares);
    }

    function zapIn(
        address tokenIn,
        uint256 amountIn,
        uint256 amountOutMinimum,
        uint24 fee
    ) external nonReentrant returns (uint256 shares) {
        require(tokenIn != address(sushi), "Use deposit() for Sushi");

        // Transfer tokens from user to this contract
        IERC20(tokenIn).transferFrom(msg.sender, address(this), amountIn);

        // Approve the router to spend the tokens
        IERC20(tokenIn).approve(address(router), amountIn);

        // Perform the swap via the router
        uint256 sushiReceived = router.exactInputSingle(
            ISwapRouter.ExactInputSingleParams({
                tokenIn: tokenIn,
                tokenOut: address(sushi),
                fee: fee,
                recipient: address(this),
                deadline: block.timestamp,
                amountIn: amountIn,
                amountOutMinimum: amountOutMinimum,
                sqrtPriceLimitX96: 0
            })
        );

        // Check if we received any Sushi tokens
        require(sushiReceived > 0, "No Sushi received from swap");

        // Calculate shares based on the received Sushi
        shares = previewDeposit(sushiReceived);

        // Approve SushiBar to spend the Sushi tokens
        IERC20(sushi).approve(address(sushiBar), sushiReceived);

        // Deposit Sushi into SushiBar
        sushiBar.enter(sushiReceived);

        // Mint shares to msg.sender
        _mint(msg.sender, shares);

        emit Deposit(msg.sender, msg.sender, sushiReceived, shares);
        return shares;
    }
}
