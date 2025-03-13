require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();
const tenderly = require("@tenderly/hardhat-tenderly");


module.exports = {
  solidity: "0.8.20",
  networks: {
    hardhat: {
      forking: {
        url: "https://eth-mainnet.public.blastapi.io",
        blockNumber: 21080117,
      },
    },
    virtualMainnet: {
      url: process.env.TENDERLY_VIRTUAL_MAINNET_RPC,
      chainId: 1
    },
  },
  tenderly: {
    project: "XSushiVault",
    username: "musti17",
  },
};
