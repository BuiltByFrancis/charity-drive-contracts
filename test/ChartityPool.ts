import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { expect } from "chai";
import { id } from "ethers";
import { ethers } from "hardhat";

const oneEther = ethers.parseEther("1");

describe("CharityPool", function () {
    async function fixture() {
        const [deployer, owner, donator, bad, recipient] = await ethers.getSigners();

        const ExternalContract = await ethers.getContractFactory("ExternalContract");
        const externalContract = await ExternalContract.deploy();
        await externalContract.waitForDeployment();

        await externalContract.toggleBlocked();

        const WETH = await ethers.getContractFactory("WETH9");
        const weth = await WETH.deploy();
        await weth.waitForDeployment();

        const TOKEN = await ethers.getContractFactory("MockERC20");
        const approvedToken = await TOKEN.deploy();
        await approvedToken.waitForDeployment();

        const otherToken = await TOKEN.deploy();
        await otherToken.waitForDeployment();

        const SUT = await ethers.getContractFactory("CharityPool");
        const sut = await SUT.deploy(weth.target, owner.address);
        await sut.waitForDeployment();

        await sut.connect(owner).setTokenApproval(approvedToken.target, true);

        return {
            sut,
            weth,
            otherToken,
            approvedToken,
            externalContract,
            wallets: {
                deployer,
                owner,
                donator,
                bad,
                recipient,
            },
        };
    }

    async function fixtureWithWethBalance() {
        const data = await loadFixture(fixture);

        const { sut, weth, wallets } = data;

        // Fund the donator with some WETH
        await weth.deposit({ value: oneEther });
        await weth.transfer(wallets.donator.address, oneEther);

        // Approve the SUT to spend WETH on behalf of the donator
        await weth.connect(wallets.donator).approve(sut.target, oneEther);

        return { ...data };
    }

    async function fixtureWithTokenBalance() {
        const data = await loadFixture(fixture);

        const { sut, approvedToken, wallets } = data;

        // Fund the donator with some approved tokens
        await approvedToken.mint(wallets.donator.address, oneEther);

        // Approve the SUT to spend approved tokens on behalf of the donator
        await approvedToken.connect(wallets.donator).approve(sut.target, oneEther);

        return { ...data };
    }

    async function fixtureWithDonatedEther() {
        const data = await loadFixture(fixtureWithWethBalance);

        const { sut, wallets } = data;

        // Donator donates some Ether
        await sut.connect(wallets.donator).donateEther(oneEther);

        return { ...data };
    }

    async function fixtureWithDonatedToken() {
        const data = await loadFixture(fixtureWithTokenBalance);

        const { sut, approvedToken, wallets } = data;

        // Donator donates some tokens
        await sut.connect(wallets.donator).donateToken(approvedToken.target, oneEther);

        return { ...data };
    }

    // ############################ TESTS ############################

    describe("constructor", function () {
        it("Should set the owner address", async function () {
            const { sut, wallets } = await loadFixture(fixture);

            expect(await sut.owner()).to.equal(wallets.owner.address);
        });

        it("Should set the WETH address", async function () {
            const { sut, weth } = await loadFixture(fixture);

            expect(await sut.WETH()).to.equal(weth.target);
        });

        it("Should set the WETH as an approved token", async function () {
            const { sut, weth } = await loadFixture(fixture);

            expect(await sut.isTokenApproved(weth.target)).to.equal(true);
        });

        it("Should emit TokenApprovalChanged", async function () {
            const { weth, wallets } = await loadFixture(fixture);

            const SUT = await ethers.getContractFactory("CharityPool");
            const tx = await SUT.deploy(weth.target, wallets.owner.address);
            const receipt = (await tx.deploymentTransaction()!.wait())!;

            const iface = SUT.interface;

            expect(
                receipt.logs
                    .filter((log) => log.topics[0] === id("TokenApprovalChanged(address,bool)"))
                    .map((log) => iface.decodeEventLog("TokenApprovalChanged", log.data, log.topics))
            ).to.deep.equal([[weth.target, true]]);
        });
    });

    describe("receive (msg.sender != _weth)", function () {
        it("Should revert if the amount is zero", async function () {
            const { sut, wallets } = await loadFixture(fixtureWithWethBalance);

            await expect(
                wallets.donator.sendTransaction({
                    to: sut.target,
                    value: 0n,
                })
            ).to.be.revertedWithCustomError(sut, "AmountCannotBeZero");
        });

        it("Should convert the amount to weth", async function () {
            const { sut, weth, wallets } = await loadFixture(fixtureWithWethBalance);

            const initialBalance = await sut.tokenBalance(weth.target);
            await wallets.donator.sendTransaction({
                to: sut.target,
                value: oneEther,
            });
            const finalBalance = await sut.tokenBalance(weth.target);

            expect(finalBalance).to.equal(initialBalance + oneEther);
        });

        it("Should emit DonationReceived", async function () {
            const { sut, weth, wallets } = await loadFixture(fixtureWithWethBalance);

            await expect(
                wallets.donator.sendTransaction({
                    to: sut.target,
                    value: oneEther,
                })
            )
                .to.emit(sut, "DonationReceived")
                .withArgs(wallets.donator.address, oneEther, weth.target);
        });
    });

    describe("donateEther", function () {
        it("Should revert if the total is zero", async function () {
            const { sut, wallets } = await loadFixture(fixtureWithWethBalance);

            await expect(sut.connect(wallets.donator).donateEther(0)).to.be.revertedWithCustomError(
                sut,
                "AmountCannotBeZero"
            );
        });

        it("Should revert if the caller has not approved weth", async function () {
            const { sut, weth, wallets } = await loadFixture(fixtureWithWethBalance);

            await weth.connect(wallets.donator).approve(sut.target, 0);

            await expect(sut.connect(wallets.donator).donateEther(oneEther)).to.be.reverted;
        });

        it("Should revert if the caller has insufficient weth", async function () {
            const { sut, weth, wallets } = await loadFixture(fixtureWithWethBalance);

            await weth.connect(wallets.donator).approve(sut.target, oneEther * 2n);

            await expect(sut.connect(wallets.donator).donateEther(oneEther * 2n)).to.be.reverted;
        });

        it("Should receive only ether", async function () {
            const { sut, weth, wallets } = await loadFixture(fixtureWithWethBalance);

            const initialBalance = await weth.balanceOf(sut.target);
            await sut.connect(wallets.donator).donateEther(0, { value: oneEther });
            const finalBalance = await weth.balanceOf(sut.target);

            expect(finalBalance).to.equal(initialBalance + oneEther);
        });

        it("Should receive only weth", async function () {
            const { sut, weth, wallets } = await loadFixture(fixtureWithWethBalance);

            const initialBalance = await weth.balanceOf(sut.target);
            await sut.connect(wallets.donator).donateEther(oneEther);
            const finalBalance = await weth.balanceOf(sut.target);

            expect(finalBalance).to.equal(initialBalance + oneEther);
        });

        it("Should receive both ether and weth", async function () {
            const { sut, weth, wallets } = await loadFixture(fixtureWithWethBalance);

            const initialBalance = await weth.balanceOf(sut.target);
            await sut.connect(wallets.donator).donateEther(oneEther, { value: oneEther });
            const finalBalance = await weth.balanceOf(sut.target);

            expect(finalBalance).to.equal(initialBalance + oneEther + oneEther);
        });

        it("Should emit DonationReceived", async function () {
            const { sut, weth, wallets } = await loadFixture(fixtureWithWethBalance);

            await expect(sut.connect(wallets.donator).donateEther(oneEther, { value: oneEther }))
                .to.emit(sut, "DonationReceived")
                .withArgs(wallets.donator.address, oneEther * 2n, weth.target);
        });
    });

    describe("donateToken", function () {
        it("Should revert if the amount is zero", async function () {
            const { sut, approvedToken, wallets } = await loadFixture(fixtureWithTokenBalance);

            await expect(
                sut.connect(wallets.donator).donateToken(approvedToken.target, 0)
            ).to.be.revertedWithCustomError(sut, "AmountCannotBeZero");
        });

        it("Should revert if the token is not approved", async function () {
            const { sut, otherToken, wallets } = await loadFixture(fixtureWithTokenBalance);

            await expect(sut.connect(wallets.donator).donateToken(otherToken.target, oneEther))
                .to.be.revertedWithCustomError(sut, "TokenIsNotApproved")
                .withArgs(otherToken.target);
        });

        it("Should revert if the caller has not approved", async function () {
            const { sut, approvedToken, wallets } = await loadFixture(fixtureWithTokenBalance);

            await approvedToken.connect(wallets.donator).approve(sut.target, 0);

            await expect(sut.connect(wallets.donator).donateToken(approvedToken.target, oneEther))
                .to.be.revertedWithCustomError(approvedToken, "ERC20InsufficientAllowance")
                .withArgs(sut.target, 0n, oneEther);
        });

        it("Should revert if the caller has insufficient balance", async function () {
            const { sut, approvedToken, wallets } = await loadFixture(fixtureWithTokenBalance);

            await approvedToken.connect(wallets.donator).approve(sut.target, oneEther * 2n);

            await expect(sut.connect(wallets.donator).donateToken(approvedToken.target, oneEther * 2n))
                .to.be.revertedWithCustomError(approvedToken, "ERC20InsufficientBalance")
                .withArgs(wallets.donator.address, oneEther, oneEther * 2n);
        });

        it("Should revert if the token transfer returns false", async function () {
            const { sut, approvedToken, wallets } = await loadFixture(fixtureWithTokenBalance);

            await approvedToken.mockReturn();

            await expect(sut.connect(wallets.donator).donateToken(approvedToken.target, oneEther))
                .to.be.revertedWithCustomError(sut, "SafeERC20FailedOperation")
                .withArgs(approvedToken.target);
        });

        it("Should receive the token amount", async function () {
            const { sut, approvedToken, wallets } = await loadFixture(fixtureWithTokenBalance);

            const initialBalance = await approvedToken.balanceOf(sut.target);
            await sut.connect(wallets.donator).donateToken(approvedToken.target, oneEther);
            const finalBalance = await approvedToken.balanceOf(sut.target);

            expect(finalBalance).to.equal(initialBalance + oneEther);
        });

        it("Should emit DonationReceived", async function () {
            const { sut, approvedToken, wallets } = await loadFixture(fixtureWithTokenBalance);

            await expect(sut.connect(wallets.donator).donateToken(approvedToken.target, oneEther))
                .to.emit(sut, "DonationReceived")
                .withArgs(wallets.donator.address, oneEther, approvedToken.target);
        });
    });

    describe("claimEther", function () {
        it("Should revert if the caller is not the owner", async function () {
            const { sut, wallets } = await loadFixture(fixtureWithDonatedEther);

            await expect(sut.connect(wallets.bad).claimEther(wallets.recipient.address))
                .to.be.revertedWithCustomError(sut, "OwnableUnauthorizedAccount")
                .withArgs(wallets.bad.address);
        });

        it("Should revert if there is insufficient balance", async function () {
            const { sut, wallets } = await loadFixture(fixture);

            await expect(
                sut.connect(wallets.owner).claimEther(wallets.recipient.address)
            ).to.be.revertedWithCustomError(sut, "AmountCannotBeZero");
        });

        it("Should revert if the eth transfer fails", async function () {
            const { sut, wallets, externalContract } = await loadFixture(fixtureWithDonatedEther);

            await expect(sut.connect(wallets.owner).claimEther(externalContract.target)).to.be.revertedWithCustomError(
                sut,
                "FailedToTransferEther"
            );
        });

        it("Should transfer the full amount to the recipient wallet", async function () {
            const { sut, weth, wallets } = await loadFixture(fixtureWithDonatedEther);

            const initialBalance = await ethers.provider.getBalance(wallets.recipient.address);
            const sutBalance = await weth.balanceOf(sut.target);

            await sut.connect(wallets.owner).claimEther(wallets.recipient.address);

            const finalBalance = await ethers.provider.getBalance(wallets.recipient.address);
            const finalSutBalance = await weth.balanceOf(sut.target);

            expect(finalBalance).to.equal(initialBalance + sutBalance);
            expect(finalSutBalance).to.equal(0);
        });

        it("Should transfer the full amount to the recipient contract", async function () {
            const { sut, weth, externalContract, wallets } = await loadFixture(fixtureWithDonatedEther);

            externalContract.toggleBlocked();

            const initialBalance = await ethers.provider.getBalance(externalContract.target);
            const sutBalance = await weth.balanceOf(sut.target);

            await sut.connect(wallets.owner).claimEther(externalContract.target);

            const finalBalance = await ethers.provider.getBalance(externalContract.target);
            const finalSutBalance = await weth.balanceOf(sut.target);

            expect(finalBalance).to.equal(initialBalance + sutBalance);
            expect(finalSutBalance).to.equal(0);
        });

        it("Should emit DonationClaimed", async function () {
            const { sut, weth, wallets } = await loadFixture(fixtureWithDonatedEther);

            await expect(sut.connect(wallets.owner).claimEther(wallets.owner.address))
                .to.emit(sut, "DonationClaimed")
                .withArgs(wallets.owner.address, oneEther, weth.target);
        });
    });

    describe("claimEtherPartial", function () {
        const claimAmount = ethers.parseEther("0.6");
        const expectedRemainder = ethers.parseEther("0.4");

        it("Should revert if the caller is not the owner", async function () {
            const { sut, wallets } = await loadFixture(fixtureWithDonatedEther);

            await expect(sut.connect(wallets.bad).claimEtherPartial(wallets.recipient.address, claimAmount))
                .to.be.revertedWithCustomError(sut, "OwnableUnauthorizedAccount")
                .withArgs(wallets.bad.address);
        });

        it("Should revert if the amount is zero", async function () {
            const { sut, wallets } = await loadFixture(fixture);

            await expect(
                sut.connect(wallets.owner).claimEtherPartial(wallets.recipient.address, 0n)
            ).to.be.revertedWithCustomError(sut, "AmountCannotBeZero");
        });

        it("Should revert if there is insufficient balance", async function () {
            const { sut, wallets } = await loadFixture(fixture);

            await expect(sut.connect(wallets.owner).claimEtherPartial(wallets.recipient.address, oneEther * 2n)).to.be
                .reverted;
        });

        it("Should revert if the eth transfer fails", async function () {
            const { sut, wallets, externalContract } = await loadFixture(fixtureWithDonatedEther);

            await expect(
                sut.connect(wallets.owner).claimEtherPartial(externalContract.target, claimAmount)
            ).to.be.revertedWithCustomError(sut, "FailedToTransferEther");
        });

        it("Should transfer the full amount to the recipient wallet", async function () {
            const { sut, weth, wallets } = await loadFixture(fixtureWithDonatedEther);

            const initialBalance = await ethers.provider.getBalance(wallets.recipient.address);

            await sut.connect(wallets.owner).claimEtherPartial(wallets.recipient.address, claimAmount);

            const finalBalance = await ethers.provider.getBalance(wallets.recipient.address);
            const finalSutBalance = await weth.balanceOf(sut.target);

            expect(finalBalance).to.equal(initialBalance + claimAmount);
            expect(finalSutBalance).to.equal(expectedRemainder);
        });

        it("Should transfer the full amount to the recipient contract", async function () {
            const { sut, weth, externalContract, wallets } = await loadFixture(fixtureWithDonatedEther);

            externalContract.toggleBlocked();

            const initialBalance = await ethers.provider.getBalance(externalContract.target);

            await sut.connect(wallets.owner).claimEtherPartial(externalContract.target, claimAmount);

            const finalBalance = await ethers.provider.getBalance(externalContract.target);
            const finalSutBalance = await weth.balanceOf(sut.target);

            expect(finalBalance).to.equal(initialBalance + claimAmount);
            expect(finalSutBalance).to.equal(expectedRemainder);
        });

        it("Should emit DonationClaimed", async function () {
            const { sut, weth, wallets } = await loadFixture(fixtureWithDonatedEther);

            await expect(sut.connect(wallets.owner).claimEtherPartial(wallets.recipient.address, claimAmount))
                .to.emit(sut, "DonationClaimed")
                .withArgs(wallets.recipient.address, claimAmount, weth.target);
        });
    });

    describe("claimToken", function () {
        it("Should revert if the caller is not the owner", async function () {
            const { sut, approvedToken, wallets } = await loadFixture(fixtureWithDonatedToken);

            await expect(sut.connect(wallets.bad).claimToken(approvedToken.target, wallets.recipient.address))
                .to.be.revertedWithCustomError(sut, "OwnableUnauthorizedAccount")
                .withArgs(wallets.bad.address);
        });

        it("Should revert if the token is not approved", async function () {
            const { sut, otherToken, wallets } = await loadFixture(fixtureWithDonatedToken);

            await expect(sut.connect(wallets.owner).claimToken(otherToken.target, wallets.recipient.address))
                .to.be.revertedWithCustomError(sut, "TokenIsNotApproved")
                .withArgs(otherToken.target);
        });

        it("Should revert if there is insufficient balance", async function () {
            const { sut, approvedToken, wallets } = await loadFixture(fixture);

            await expect(
                sut.connect(wallets.owner).claimToken(approvedToken.target, wallets.recipient.address)
            ).to.be.revertedWithCustomError(sut, "AmountCannotBeZero");
        });

        it("Should revert if the token transfer fails", async function () {
            const { sut, wallets, approvedToken } = await loadFixture(fixtureWithDonatedToken);

            await approvedToken.mockReturn();

            await expect(sut.connect(wallets.owner).claimToken(approvedToken.target, wallets.recipient.address))
                .to.be.revertedWithCustomError(sut, "SafeERC20FailedOperation")
                .withArgs(approvedToken.target);
        });

        it("Should transfer the full amount to the recipient wallet", async function () {
            const { sut, approvedToken, wallets } = await loadFixture(fixtureWithDonatedToken);

            const initialBalance = await approvedToken.balanceOf(wallets.recipient.address);
            const sutBalance = await approvedToken.balanceOf(sut.target);

            await sut.connect(wallets.owner).claimToken(approvedToken.target, wallets.recipient.address);

            const finalBalance = await approvedToken.balanceOf(wallets.recipient.address);
            const finalSutBalance = await approvedToken.balanceOf(sut.target);

            expect(finalBalance).to.equal(initialBalance + sutBalance);
            expect(finalSutBalance).to.equal(0);
        });

        it("Should emit DonationClaimed", async function () {
            const { sut, approvedToken, wallets } = await loadFixture(fixtureWithDonatedToken);

            await expect(sut.connect(wallets.owner).claimToken(approvedToken.target, wallets.owner.address))
                .to.emit(sut, "DonationClaimed")
                .withArgs(wallets.owner.address, oneEther, approvedToken.target);
        });
    });

    describe("claimTokenPartial", function () {
        const claimAmount = ethers.parseEther("0.6");
        const expectedRemainder = ethers.parseEther("0.4");

        it("Should revert if the caller is not the owner", async function () {
            const { sut, approvedToken, wallets } = await loadFixture(fixtureWithDonatedToken);

            await expect(
                sut.connect(wallets.bad).claimTokenPartial(approvedToken.target, wallets.recipient.address, claimAmount)
            )
                .to.be.revertedWithCustomError(sut, "OwnableUnauthorizedAccount")
                .withArgs(wallets.bad.address);
        });

        it("Should revert if the token is not approved", async function () {
            const { sut, otherToken, wallets } = await loadFixture(fixtureWithDonatedToken);

            await expect(
                sut.connect(wallets.owner).claimTokenPartial(otherToken.target, wallets.recipient.address, claimAmount)
            )
                .to.be.revertedWithCustomError(sut, "TokenIsNotApproved")
                .withArgs(otherToken.target);
        });

        it("Should revert if the amount is zero", async function () {
            const { sut, approvedToken, wallets } = await loadFixture(fixture);

            await expect(
                sut.connect(wallets.owner).claimTokenPartial(approvedToken.target, wallets.recipient.address, 0n)
            ).to.be.revertedWithCustomError(sut, "AmountCannotBeZero");
        });

        it("Should revert if there is insufficient balance", async function () {
            const { sut, approvedToken, wallets } = await loadFixture(fixture);

            await expect(
                sut.connect(wallets.owner).claimTokenPartial(approvedToken.target, wallets.recipient.address, oneEther)
            )
                .to.be.revertedWithCustomError(approvedToken, "ERC20InsufficientBalance")
                .withArgs(sut.target, 0n, oneEther);
        });

        it("Should revert if the token transfer fails", async function () {
            const { sut, wallets, approvedToken } = await loadFixture(fixtureWithDonatedToken);

            await approvedToken.mockReturn();

            await expect(
                sut.connect(wallets.owner).claimTokenPartial(approvedToken.target, wallets.recipient, claimAmount)
            )
                .to.be.revertedWithCustomError(sut, "SafeERC20FailedOperation")
                .withArgs(approvedToken.target);
        });

        it("Should transfer the full amount to the recipient", async function () {
            const { sut, approvedToken, wallets } = await loadFixture(fixtureWithDonatedToken);

            const initialBalance = await approvedToken.balanceOf(wallets.recipient.address);

            await sut
                .connect(wallets.owner)
                .claimTokenPartial(approvedToken.target, wallets.recipient.address, claimAmount);

            const finalBalance = await approvedToken.balanceOf(wallets.recipient.address);
            const finalSutBalance = await approvedToken.balanceOf(sut.target);

            expect(finalBalance).to.equal(initialBalance + claimAmount);
            expect(finalSutBalance).to.equal(expectedRemainder);
        });

        it("Should emit DonationClaimed", async function () {
            const { sut, approvedToken, wallets } = await loadFixture(fixtureWithDonatedToken);

            await expect(
                sut
                    .connect(wallets.owner)
                    .claimTokenPartial(approvedToken.target, wallets.recipient.address, claimAmount)
            )
                .to.emit(sut, "DonationClaimed")
                .withArgs(wallets.recipient.address, claimAmount, approvedToken.target);
        });
    });

    describe("setTokenApproval", function () {
        it("Should revert if the caller is not the owner", async function () {
            const { sut, otherToken, wallets } = await loadFixture(fixture);

            await expect(sut.connect(wallets.bad).setTokenApproval(otherToken.target, true))
                .to.be.revertedWithCustomError(sut, "OwnableUnauthorizedAccount")
                .withArgs(wallets.bad.address);
        });

        it("Should set a token approval to true", async function () {
            const { sut, otherToken, wallets } = await loadFixture(fixture);

            expect(await sut.isTokenApproved(otherToken.target)).to.equal(false);
            await sut.connect(wallets.owner).setTokenApproval(otherToken.target, true);
            expect(await sut.isTokenApproved(otherToken.target)).to.equal(true);
        });

        it("Should set a token approval to false", async function () {
            const { sut, approvedToken, wallets } = await loadFixture(fixture);

            expect(await sut.isTokenApproved(approvedToken.target)).to.equal(true);
            await sut.connect(wallets.owner).setTokenApproval(approvedToken.target, false);
            expect(await sut.isTokenApproved(approvedToken.target)).to.equal(false);
        });

        it("Should emit TokenApprovalChanged", async function () {
            const { sut, otherToken, wallets } = await loadFixture(fixture);

            await expect(sut.connect(wallets.owner).setTokenApproval(otherToken.target, true))
                .to.emit(sut, "TokenApprovalChanged")
                .withArgs(otherToken.target, true);
        });
    });
});
