import hre, { ethers } from "hardhat";
import { WETH9, DemoERC20, CharityPool } from "../typechain-types";

interface Verify {
    address: string;
    constructorArguments: any[];
}

const toVerify: Verify[] = [];

async function main() {
    console.log(`Running deploy script`, hre.network.name);

    const owner = "0xFe71f3757B8c828dDbE21429308a504b0f665353";

    const erc20 = await deploy<DemoERC20>("DemoERC20", []);
    const weth = await deploy<WETH9>("WETH9", []);
    const charityPool = await deploy<CharityPool>("CharityPool", [weth.target, owner]);

    await tx(charityPool.setTokenApproval(erc20.target, true));

    await verifyAll();
}

async function deploy<V>(contractName: string, args: any[] = []): Promise<V> {
    const Factory = await ethers.getContractFactory(contractName);
    const contract = await Factory.deploy(...args);
    await contract.waitForDeployment();

    const address = await contract.getAddress();

    toVerify.push({
        address: address,
        constructorArguments: args,
    });

    console.log(`${contractName} was deployed to ${address}`);

    return contract as V;
}

async function tx(transaction: Promise<any>) {
    await (await transaction).wait();
}

async function verifyAll() {
    await sleep(90000);

    console.log(`Verifying contracts...`);
    for (const item of toVerify) {
        try {
            await verify(item.address, item.constructorArguments);
            console.log(`Verified ${item.address}`);
        } catch (error) {
            console.error(`Failed to verify ${item.address}:`, error);
        }
    }
}

async function verify(address: string, args: any[]) {
    await sleep(1000);
    return hre.run("verify:verify", {
        address,
        constructorArguments: args,
    });
}

function sleep(ms: number) {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
