import { HardhatUserConfig, vars } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";

const COINMARKETCAP_API_KEY = vars.get("COINMARKETCAP_API_KEY");
const ETHERSCAN_API_KEY = vars.get("ETHERSCAN_API_KEY");
const ALCHEMY_API_KEY = vars.get("ALCHEMY_API_KEY");

function accounts() {
    const privateKey = vars.get("DEV_PRIVATE_KEY");
    return [`0x${privateKey}`];
}

const config: HardhatUserConfig = {
    solidity: {
        version: "0.8.28",
        settings: {
            optimizer: {
                enabled: true,
                runs: 200,
            },
        },
    },
    networks: {
        hardhat: {},

        // mainnets
        ethereum: {
            url: `https://eth-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`,
            chainId: 1,
            accounts: accounts(),
        },

        // testnets
        sepolia: {
            url: `https://eth-sepolia.g.alchemy.com/v2/${ALCHEMY_API_KEY}`,
            chainId: 11155111,
            accounts: accounts(),
        },
    },
    etherscan: {
        apiKey: {
            mainnet: `${ETHERSCAN_API_KEY}`,
            sepolia: `${ETHERSCAN_API_KEY}`,
        },
    },
    gasReporter: {
        coinmarketcap: `${COINMARKETCAP_API_KEY}`,
        gasPriceApi: `https://api.basescan.org/api?module=proxy&action=eth_gasPrice`,
        enabled: true,
        currency: "USD",
    },
    mocha: {
        timeout: 1000000,
    },
};

export default config;

