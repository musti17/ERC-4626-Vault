# XSushiVault - ERC4626 Tokenized Vault

## Overview

XSushiVault is an ERC4626-compliant tokenized vault, ensuring seamless integration with other DeFi protocols that support this standard. It allows users to deposit Sushi tokens, stake them in the SushiBar, and receive vault shares representing their stake. The zap functionality simplifies deposits by swapping supported tokens (e.g., USDC, WETH) for Sushi via Uniswap V3 in a single transaction. Security is prioritized with OpenZeppelin’s ReentrancyGuard and SafeERC20 for robust protection and safe token handling.

## Features

- **ERC4626 Standard Compliance**: Implements the ERC4626 tokenized vault standard for ease of integration with DeFi protocols.
- **SushiBar Staking**: Deposited Sushi is staked in the SushiBar, earning xSushi.
- **Token Swapping / Zap Functionality**: Users can deposit different tokens, which are swapped for Sushi before being staked.
- **Secure & Optimized**: Implements OpenZeppelin security best practices, including reentrancy protection and safe token transfers.

## Setup & Running the Project Locally

### Pre-requisites for initial setup

- - Install [NodeJS](https://nodejs.org/en/)

### Setting Up

1. Clone the repository:
   ```sh
   git clone https://github.com/musti17/ERC-4626-Vault.git
   ```
2. Install dependencies:
   ```sh
   npm install
   ```
3. Start a local Hardhat blockchain (forking mainnet to simulate mainnet conditions by providing blocknumber and rpc in hardhat.config.js):

   ```sh
   npx hardhat node
   ```

4. For Running Smart Contract Tests

```sh
npx hardhat test tests/XSushiVault.test.js
```

## Key Design Decisions

The following decisions were made to balance security, gas efficiency, and functionality in XSushiVault:

- **Precise Approval Management**

  - **Decision**: Approves the exact amount of tokens needed for each operation (e.g., staking Sushi or unstaking xSushi) rather than using infinite approvals.
  - **Reasoning**: Infinite approvals could save ~20,000 gas per call by avoiding repeated approvals, but they pose a security risk—if the SushiBar or router is compromised, the vault’s tokens could be drained. Security is prioritized over gas savings in this DeFi context.

- **No Batch Operations**

  - **Decision**: Does not implement batch deposit or withdrawal functions.
  - **Reasoning**: Batching could reduce gas costs by spreading transaction overhead, but it adds complexity and edge cases. For a vault focused on individual users, the simplicity and clarity of single operations outweigh the marginal gas savings.

- **Hardcoded Swap Deadline in zapIn**

  - **Decision**: Uses a fixed deadline of `block.timestamp + 1000` for swaps in `zapIn`.
  - **Reasoning**: A user-defined deadline could avoid gas waste on delayed swaps, but the 1000-second buffer is practical and simplifies the implementation for now. The gas savings from a dynamic deadline are minimal.

- **Redundant Check in zapIn**

  - **Decision**: Includes a `require(sushiReceived > 0)` check after swaps in `zapIn`.
  - **Reasoning**: Although the SushiSwap router should revert on failed swaps, this check adds an extra safety layer against unexpected behavior, costing only ~200-300 gas. The security benefit justifies the small cost.

- **Solidity Math Over Assembly**

  - **Decision**: Uses `Math.ceilDiv` for calculations instead of inline assembly.
  - **Reasoning**: Assembly could save ~50-100 gas per operation but reduces readability and increases error risk. Maintainability and simplicity are prioritized over minor gas optimizations.

- **Immutable Variables**
  - **Decision**: Declares key addresses (e.g., `sushi`, `sushiBar`, `router`, `xSushi`) as immutable.
  - **Reasoning**: Reduces storage costs and gas usage compared to regular storage variables, enhancing efficiency without compromising security.

These decisions ensure XSushiVault is secure, gas-efficient, and maintainable while adhering to the ERC4626 standard. Further optimizations (e.g., infinite approvals or assembly) were considered but avoided due to their disproportionate risks or complexity relative to their benefits.

## Security Practices

- **Reentrancy Protection**: All state-changing functions that interact with external contracts use nonReentrant, ensuring that reentrancy attacks (where an attacker repeatedly calls a function before the first call is completed) cannot occur.
- **Use of SafeERC20**: Ensures safe interactions with ERC20 tokens, preventing unexpected failures.
- **Minimized External Calls**: External calls (e.g., swaps, staking) are optimized to reduce gas costs and attack vectors.

---

For any issues or contributions, feel free to open an issue or submit a pull request!
