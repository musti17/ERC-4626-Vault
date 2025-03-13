// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.20;
pragma abicoder v2;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";

/**
 * @title ISushiBar
 * @notice Interface for interacting with the SushiBar contract for staking Sushi.
 */
interface ISushiBar {
    function enter(uint256 _amount) external;

    function leave(uint256 _share) external;

    function balanceOf(address account) external view returns (uint256);

    function totalSupply() external view returns (uint256);
}

/**
 * @title ISwapRouter
 * @notice Interface for the DEX router used to swap tokens for Sushi.
 */
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

/**
 * @title XSushiVault
 * @notice ERC4626 vault for managing Sushi deposits and staking via the SushiBar.
 *         Also supports zap-in functionality to deposit any token convertible to Sushi.
 */
contract XSushiVault is ERC4626, ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @notice Underlying Sushi token.
    IERC20 public immutable sushi;

    /// @notice Interface for the SushiBar (staking contract).
    ISushiBar public immutable sushiBar;

    /// @notice Router used for swapping tokens
    ISwapRouter public immutable router;

    /// @notice xSushi token received when staking in the SushiBar.
    IERC20 public immutable xSushi;

    /**
     * @notice Constructor to initialize the XSushiVault.
     * @param _sushi The Sushi ERC20 token.
     * @param _sushiBar The SushiBar contract for staking Sushi.
     * @param _router The swap router for token conversion.
     * @param _xSushi The xSushi token representing staked Sushi.
     */
    constructor(
        IERC20Metadata _sushi,
        ISushiBar _sushiBar,
        ISwapRouter _router,
        IERC20 _xSushi
    ) ERC4626(_sushi) ERC20("xSushi Vault", "SUSI") {
        sushi = _sushi;
        sushiBar = _sushiBar;
        router = _router;
        xSushi = _xSushi;
    }

    /**
     * @notice Returns the total amount of Sushi assets managed by the vault.
     * @dev Calculates Sushi equivalent from the xSushi balance held by the vault.
     * @return The total Sushi assets.
     */
    function totalAssets() public view override returns (uint256) {
        uint256 xSushiBalance = xSushi.balanceOf(address(this));
        if (xSushiBalance == 0) return 0;
        uint256 totalSushiInBar = sushi.balanceOf(address(sushiBar));
        uint256 totalxSushi = xSushi.totalSupply();
        return (xSushiBalance * totalSushiInBar) / totalxSushi;
    }

    /**
     * @notice Internal function to process Sushi deposits.
     * @dev Transfers Sushi from the caller, stakes it in the SushiBar, and mints vault shares.
     * @param caller The address initiating the deposit.
     * @param receiver The address receiving the vault shares.
     * @param assets The amount of Sushi to deposit.
     * @param shares The number of vault shares to mint.
     */
    function _deposit(
        address caller,
        address receiver,
        uint256 assets,
        uint256 shares
    ) internal override nonReentrant {
        // Transfer Sushi from the caller to the vault.
        SafeERC20.safeTransferFrom(sushi, caller, address(this), assets);

        // Approve SushiBar to spend Sushi.
        sushi.approve(address(sushiBar), assets);

        // Stake Sushi into SushiBar, receiving xSushi.
        sushiBar.enter(assets);

        // Mint vault shares to the receiver.
        _mint(receiver, shares);
        emit Deposit(caller, receiver, assets, shares);
    }

    /**
     * @notice Internal function to process Sushi withdrawals.
     * @dev Unstakes the required amount of xSushi from SushiBar and transfers Sushi to the receiver.
     * @param caller The address initiating the withdrawal.
     * @param receiver The address receiving the Sushi.
     * @param owner The owner of the vault shares.
     * @param assets The amount of Sushi to withdraw.
     * @param shares The number of vault shares to burn.
     */
    function _withdraw(
        address caller,
        address receiver,
        address owner,
        uint256 assets,
        uint256 shares
    ) internal override nonReentrant {
        if (caller != owner) {
            // _spendAllowance ensures the caller is authorized by the owner and updates the allowance.
            _spendAllowance(owner, caller, shares);
        }
        // Burn the vault shares.
        _burn(owner, shares);

        // Calculate xSushi to unstake to obtain the desired Sushi amount.
        uint256 totalSushiInBar = sushi.balanceOf(address(sushiBar));
        uint256 totalxSushi = xSushi.totalSupply();
        uint256 xSushiToLeave = Math.ceilDiv(
            assets * totalxSushi,
            totalSushiInBar
        );

        // Approve the SushiBar to use xSushi for unstaking.
        xSushi.approve(address(sushiBar), xSushiToLeave);

        sushiBar.leave(xSushiToLeave);

        // Transfer the Sushi to the receiver.
        SafeERC20.safeTransfer(sushi, receiver, assets);
        emit Withdraw(caller, receiver, owner, assets, shares);
    }

    /**
     * @notice Allows users to deposit an alternative token by swapping it for Sushi.
     * @dev Uses the router to swap the specified token to Sushi, then stakes the Sushi.
     * @param tokenIn The address of the token to be swapped.
     * @param amountIn The amount of the token to deposit.
     * @param amountOutMinimum The minimum amount of Sushi expected from the swap.
     * @param fee The fee tier for the swap on Sushiswap V3.
     * @return shares The number of vault shares minted to the caller.
     */
    function zapIn(
        address tokenIn,
        uint256 amountIn,
        uint256 amountOutMinimum,
        uint24 fee
    ) external nonReentrant returns (uint256 shares) {
        require(tokenIn != address(sushi), "Use deposit() for Sushi");

        // Transfer the specified token from the user to this contract.
        IERC20(tokenIn).transferFrom(msg.sender, address(this), amountIn);

        // Approve the router to spend the input token.
        IERC20(tokenIn).approve(address(router), amountIn);

        // Perform the token swap: tokenIn -> Sushi.
        uint256 sushiReceived = router.exactInputSingle(
            ISwapRouter.ExactInputSingleParams({
                tokenIn: tokenIn,
                tokenOut: address(sushi),
                fee: fee,
                recipient: address(this),
                deadline: block.timestamp + 1000,
                amountIn: amountIn,
                amountOutMinimum: amountOutMinimum,
                sqrtPriceLimitX96: 0
            })
        );

        // Ensure that the swap returned a non-zero Sushi amount.
        require(sushiReceived > 0, "No Sushi received from swap");

        // Determine how many vault shares are owed for the Sushi deposited.
        shares = previewDeposit(sushiReceived);

        // Approve SushiBar to spend the Sushi tokens.
        IERC20(sushi).approve(address(sushiBar), sushiReceived);

        // Stake the Sushi into the SushiBar.
        sushiBar.enter(sushiReceived);

        // Mint vault shares to the sender.
        _mint(msg.sender, shares);

        emit Deposit(msg.sender, msg.sender, sushiReceived, shares);
        return shares;
    }
}
