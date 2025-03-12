require("@nomicfoundation/hardhat-toolbox")
require("dotenv").config();
// require("@tenderly/hardhat-tenderly");


module.exports = {
  solidity: "0.8.20",
  networks: {
    hardhat: {
      forking: {
        url: "https://eth-mainnet.public.blastapi.io",
        blockNumber: 21080117,
      },
    },
  },
  // tenderly: {
  //   project: "XSushiVault",
  //   username: "musti17",
  // },
};
