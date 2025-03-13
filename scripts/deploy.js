const {ethers} = require("hardhat");

async function main() {
    const [deployer] = await ethers.getSigners();
    console.log("Deploying contracts with:", deployer.address);
  
    const XSushiVault = await ethers.getContractFactory("XSushiVault");
    const vault = await XSushiVault.deploy(
      "0x6B3595068778DD592e39A122f4f5a5cF09C90fE2",
      "0x8798249c2E607446EfB7Ad49eC89dD1865Ff4272", // SushiBar address
      "0xE592427A0AEce92De3Edee1F18E0157C05861564", // Router address
      "0x8798249c2E607446EfB7Ad49eC89dD1865Ff4272"  // xSushi (SushiBar)
    );
    await vault.waitForDeployment();
  
    console.log("XSushiVault deployed to:", vault.address);
  }
  
  main()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
  