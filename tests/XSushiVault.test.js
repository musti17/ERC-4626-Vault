const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("XSushiVault Test Suite", function () {
  let vault, sushi, xSushi, sushiBar, router, usdt, user;
  let vaultAddress, userAddress, sushiAddress;
  const impersonatedAccount = "0xA78ef43Ac39681d62c61B575E3c65660E9043626";
  const routerAddress = "0x2E6cd2d30aa43f40aa81619ff4b6E0a41479B13F";
  const usdtAddress = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
  const wethAddress = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";

  function computePoolAddress(factoryAddress, tokenA, tokenB, fee) {
    const [token0, token1] =
      tokenA.toLowerCase() < tokenB.toLowerCase()
        ? [tokenA, tokenB]
        : [tokenB, tokenA];
    const poolKeyEncoded = ethers.solidityPacked(
      ["address", "address", "uint24"],
      [token0, token1, fee]
    );
    const salt = ethers.keccak256(poolKeyEncoded);
    const POOL_INIT_CODE_HASH =
      "0xe34f199b19b2b4f47f68442619d555527d244f78a3297ea89325f843f87b8b54";
    return ethers.getCreate2Address(factoryAddress, salt, POOL_INIT_CODE_HASH);
  }

  before(async () => {
    await hre.network.provider.request({
      method: "hardhat_impersonateAccount",
      params: [impersonatedAccount],
    });
    user = await ethers.getSigner(impersonatedAccount);
    userAddress = user.address;

    sushiAddress = "0x6B3595068778DD592e39A122f4f5a5cF09C90fE2";
    const sushiBarAddress = "0x8798249c2E607446EfB7Ad49eC89dD1865Ff4272";
    const xSushiAddress = sushiBarAddress;

    sushi = await ethers.getContractAt("IERC20", sushiAddress);
    xSushi = await ethers.getContractAt("IERC20", xSushiAddress);
    sushiBar = await ethers.getContractAt("ISushiBar", sushiBarAddress);
    usdt = await ethers.getContractAt("IERC20", usdtAddress);
    router = await ethers.getContractAt("ISwapRouter", routerAddress);

    console.log("Router:", router.target);

    const XSushiVault = await ethers.getContractFactory("XSushiVault");
    vault = await XSushiVault.deploy(
      sushiAddress,
      sushiBarAddress,
      routerAddress,
      sushiBarAddress
    );
    await vault.waitForDeployment();
    vaultAddress = vault.target;
    console.log("Vault deployed at:", vaultAddress);

    const usdtBalance = await usdt.balanceOf(userAddress);
    console.log("USDT Balance:", usdtBalance);

    const xSushiBalance = await xSushi.balanceOf(userAddress);
    if (xSushiBalance === 0n) throw new Error("User has no xSushi balance");

    await xSushi.connect(user).approve(sushiBarAddress, xSushiBalance);
    await sushiBar.connect(user).leave(xSushiBalance);

    const sushiBalance = await sushi.balanceOf(user.address);
    console.log(
      "User Sushi balance after withdrawal:",
      ethers.formatEther(sushiBalance)
    );
    if (sushiBalance === 0n)
      throw new Error("Failed to withdraw Sushi from SushiBar");
  });

  describe("Deposit Functionality", function () {
    it("should deposit Sushi and mint shares", async () => {
      const userSushiBalance = await sushi.balanceOf(user.address);
      expect(userSushiBalance > 0).to.be.true;

      const depositAmount = ethers.parseUnits("10", 18);
      await sushi.connect(user).approve(vaultAddress, depositAmount);

      const sharesPreview = await vault.previewDeposit(depositAmount);
      await expect(vault.connect(user).deposit(depositAmount, userAddress))
        .to.emit(vault, "Deposit")
        .withArgs(userAddress, userAddress, depositAmount, sharesPreview);

      const userVaultShares = await vault.balanceOf(userAddress);
      expect(userVaultShares).to.equal(sharesPreview);

      const vaultxSushiBalance = await xSushi.balanceOf(vaultAddress);
      expect(vaultxSushiBalance > 0).to.be.true;
    });

    it("should revert on deposit with insufficient balance", async () => {
      const userBalance = await sushi.balanceOf(userAddress);
      const excessiveAmount = userBalance + ethers.parseUnits("1", 18);
      await sushi.connect(user).approve(vaultAddress, excessiveAmount);
      await expect(
        vault.connect(user).deposit(excessiveAmount, userAddress)
      ).to.be.revertedWith("ERC20: transfer amount exceeds balance");
    });
  });

  describe("Withdrawal Functionality", function () {
    it("should allow withdrawal of Sushi", async () => {
      // Deposit 10 Sushi tokens first
      const depositAmount = ethers.parseUnits("10", 18);
      await sushi.connect(user).approve(vaultAddress, depositAmount);
      await vault.connect(user).deposit(depositAmount, userAddress);

      // Record user's Sushi balance before withdrawal
      const sushiBefore = await sushi.balanceOf(userAddress);

      // Use previewWithdraw to determine the expected number of shares to be burned
      const expectedShares = await vault.previewWithdraw(depositAmount);

      // Execute the withdrawal and expect the Withdraw event to be emitted
      await expect(
        vault.connect(user).withdraw(depositAmount, userAddress, userAddress)
      )
        .to.emit(vault, "Withdraw")
        .withArgs(
          userAddress,
          userAddress,
          userAddress,
          depositAmount,
          expectedShares
        );

      // Check that the user's Sushi balance has increased by at least the withdrawal amount.
      const sushiAfter = await sushi.balanceOf(userAddress);
      expect(sushiAfter - sushiBefore).to.equal(depositAmount);
    });
  });

  describe("Zap Functionality", function () {
    it("should check if router is deployed", async () => {
      const code = await ethers.provider.getCode(routerAddress);
      console.log("Router code length:", code.length);
      expect(code.length > 2).to.be.true;
    });

    it("should check if USDT-SUSHI pool exists", async () => {
      const routerFactory = "0xbACEB8eC6b9355Dfc0269C18bac9d6E2Bdc29C4F";
      const tokenIn = usdtAddress;
      const tokenOut = sushiAddress;
      const fee = 3000;
      const poolAddress = computePoolAddress(
        routerFactory,
        tokenIn,
        tokenOut,
        fee
      );
      const code = await ethers.provider.getCode(poolAddress);
      expect(code.length).to.be.greaterThan(
        0,
        "USDT-SUSHI pool does not exist"
      );
    });

    it("should check USDT-SUSHI pool liquidity", async () => {
      const routerFactory = "0xbACEB8eC6b9355Dfc0269C18bac9d6E2Bdc29C4F";
      const tokenA = sushiAddress;
      const tokenB = usdtAddress;
      const feeTiers = [500, 3000, 10000]; // 0.05%, 0.3%, 1%

      for (const fee of feeTiers) {
        const poolAddress = computePoolAddress(
          routerFactory,
          tokenA,
          tokenB,
          fee
        );
        const pool = new ethers.Contract(
          poolAddress,
          IUniswapV3PoolABI,
          ethers.provider
        );
        try {
          const slot0 = await pool.slot0();
          console.log(
            `Fee Tier ${fee}: Liquidity = ${slot0.liquidity.toString()}`
          );
          if (slot0.liquidity > 0) {
            expect(slot0.liquidity).to.be.gt(0, "Pool has no liquidity");
            return; // Exit once a valid pool is found
          }
        } catch (error) {
          console.log(
            `Fee Tier ${fee}: Pool does not exist or has no liquidity`
          );
        }
      }
      throw new Error("No active USDT-SUSHI pool found with liquidity");
    });

    it("should revert on zapIn with insufficient USDT balance", async () => {
      const amountIn = ethers.parseUnits("1000000", 6); // Exceeds user's balance
      await usdt.connect(user).approve(vaultAddress, amountIn);
      await expect(vault.connect(user).zapIn(usdtAddress, amountIn, 0, 3000)).to
        .be.reverted;
    });

    it("should revert on zapIn with high slippage protection", async () => {
      const amountIn = ethers.parseUnits("10", 6);
      const amountOutMinimum = ethers.parseUnits("1000", 18); // Unrealistic Sushi amount
      await usdt.connect(user).approve(vaultAddress, amountIn);
      await expect(
        vault.connect(user).zapIn(usdtAddress, amountIn, amountOutMinimum, 3000)
      ).to.be.reverted;
    });

    it("should perform zapIn with USDT and mint shares", async () => {
      // Initial balances
      const initialUSDTBalance = await usdt.balanceOf(userAddress);
      const initialShares = await vault.balanceOf(userAddress);
      const initialVaultxSushi = await xSushi.balanceOf(vaultAddress);

      // Zap parameters
      const amountIn = ethers.parseUnits("100", 6);
      const amountOutMinimum = 1;
      const fee = 3000;

      // Approve vault to spend USDT
      await usdt.connect(user).approve(vaultAddress, amountIn);

      // Execute zapIn
      const tx = await vault
        .connect(user)
        .zapIn(usdtAddress, amountIn, amountOutMinimum, fee);

      // Check USDT balance decreased
      const finalUSDTBalance = await usdt.balanceOf(userAddress);
      expect(finalUSDTBalance).to.equal(initialUSDTBalance - amountIn);

      // Check shares increased
      const finalShares = await vault.balanceOf(userAddress);
      expect(finalShares).to.be.gt(initialShares);

      // Check vault's xSUSHI balance increased
      const finalVaultxSushi = await xSushi.balanceOf(vaultAddress);
      expect(finalVaultxSushi).to.be.gt(initialVaultxSushi);

      await expect(tx)
        .to.emit(vault, "Deposit")
        .withArgs(
          userAddress,
          userAddress,
          anyValue,
          finalShares - initialShares
        );
    });

    it("should revert on zapIn with high slippage protection", async () => {
      const amountIn = ethers.parseUnits("10", 6);
      const amountOutMinimum = ethers.parseUnits("1000", 18); // Unrealistic Sushi amount
      await usdt.connect(user).approve(vaultAddress, amountIn);
      await expect(
        vault.connect(user).zapIn(usdtAddress, amountIn, amountOutMinimum, 3000)
      ).to.be.reverted; // Reverts due to insufficient output
    });

    it("should revert if zapIn is called with Sushi", async () => {
      const sushiAmount = ethers.parseUnits("10", 18);
      await sushi.connect(user).approve(vaultAddress, sushiAmount);

      await expect(
        vault.connect(user).zapIn(sushiAddress, sushiAmount, 1, 3000)
      ).to.be.revertedWith("Use deposit() for Sushi");
    });
  });
});
