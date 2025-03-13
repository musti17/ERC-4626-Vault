const { expect } = require("chai");
const { ethers } = require("hardhat");
const {
  IMPERSONATEDACCOUNT,
  ROUTERADDRESS,
  USDTADDRESS,
  WETHADDRESS,
  SUSHIADDRESS,
  SUSHIBARADDRESS,
  ROUTERFACTORY,
} = require("../constants.js");

describe("XSushiVault Test Suite", function () {
  let vault, sushi, xSushi, sushiBar, router, usdt, user;
  let vaultAddress, userAddress, sushiAddress;
  const impersonatedAccount = IMPERSONATEDACCOUNT;
  const routerAddress = ROUTERADDRESS;
  const usdtAddress = USDTADDRESS;

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

    sushiAddress = SUSHIADDRESS;
    const sushiBarAddress = SUSHIBARADDRESS;
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
    it("should revert withdrawal if user has no shares", async () => {
      await expect(
        vault
          .connect(user)
          .withdraw(ethers.parseUnits("10", 18), userAddress, userAddress)
      ).to.be.reverted;
    });

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

    it("should allow withdrawal by approved spender", async () => {
      const depositAmount = ethers.parseUnits("5", 18);
      await sushi.connect(user).approve(vaultAddress, depositAmount);
      await vault.connect(user).deposit(depositAmount, userAddress);

      const withdrawAmount = ethers.parseUnits("5", 18);
      await vault.connect(user).approve(vaultAddress, withdrawAmount);
      await vault.connect(user).withdraw(withdrawAmount, userAddress, userAddress);
    });

    it("should allow partial withdrawal of Sushi", async () => {
      const depositAmount = ethers.parseUnits("10", 18);
      await sushi.connect(user).approve(vaultAddress, depositAmount);
      await vault.connect(user).deposit(depositAmount, userAddress);

      const partialWithdraw = ethers.parseUnits("5", 18);
      await vault.connect(user).withdraw(partialWithdraw, userAddress, userAddress);

      expect(await sushi.balanceOf(userAddress)).to.be.gte(partialWithdraw);
    });
  });

  describe("Zap Functionality", function () {
    it("should check if router is deployed", async () => {
      const code = await ethers.provider.getCode(routerAddress);
      console.log("Router code length:", code.length);
      expect(code.length > 2).to.be.true;
    });

    it("should check if USDT-SUSHI pool exists", async () => {
      const routerFactory = ROUTERFACTORY;
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
      // Zap parameters
      const amountIn = ethers.parseUnits("20", 6);
      const fee = 10000;

      // Check initial USDT balance
      const initialUSDTBalance = await usdt.balanceOf(userAddress);
      expect(initialUSDTBalance).to.be.gte(amountIn);

      // Approve vault to spend USDT
      await usdt.connect(user).approve(vaultAddress, amountIn);

      // Execute zapIn
      const tx = await vault.connect(user).zapIn(usdtAddress, amountIn, 0, fee);

      // Validate event with actual values
      await expect(tx).to.emit(vault, "Deposit");
    });

    //Wrote this test to debug router swap functionality
    it("should perform swap directly", async () => {
      const wethAddress = WETHADDRESS;
      const amountIn = ethers.parseUnits("100", 6);
      const weth = await ethers.getContractAt("IERC20", wethAddress);
      const deadline =
        (await ethers.provider.getBlock("latest")).timestamp + 1000;
      await usdt.connect(user).approve(routerAddress, amountIn);
      const params = {
        tokenIn: usdtAddress,
        tokenOut: wethAddress,
        fee: 500,
        recipient: userAddress,
        deadline: deadline,
        amountIn: ethers.parseUnits("100", 6),
        amountOutMinimum: 0,
        sqrtPriceLimitX96: 0,
      };
      const wethBefore = await weth.balanceOf(userAddress);
      console.log("This is wethBefore", wethBefore);
      await router.connect(user).exactInputSingle(params);
      const wethAfter = await weth.balanceOf(userAddress);
      console.log("This is wethAfter", wethAfter);
      expect(wethAfter).to.be.gt(wethBefore);
    });

    it("should revert on zapIn with high slippage protection", async () => {
      const amountIn = ethers.parseUnits("10", 6);
      const amountOutMinimum = ethers.parseUnits("1000", 18); // Unrealistic Sushi amount
      await usdt.connect(user).approve(vaultAddress, amountIn);
      await expect(
        vault.connect(user).zapIn(usdtAddress, amountIn, amountOutMinimum, 3000)
      ).to.be.reverted;
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
