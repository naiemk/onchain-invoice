import { expect } from "chai";
import { network } from "hardhat";
import { zeroPadValue } from "ethers";
import {
  ERC7821_BATCH_MODE,
  encodeBatch,
  encodeErc20Transfer,
  buildFeeTransferCall,
} from "../commerce/shared/userop.js";

describe("Wallet userOp batch (fee + transfer)", function () {
  const ENTRYPOINT = "0x433709009B8330FDa32311DF1C2AFA402eD8D009";
  const BENEFICIARY = "0x1111111111111111111111111111111111111111";
  const RECIPIENT = "0x2222222222222222222222222222222222222222";

  it("executes fee + USDC transfer batch as EntryPoint", async function () {
    const { ethers } = (await network.create()) as Awaited<ReturnType<typeof network.create>> & { ethers: any };
    const [owner] = await ethers.getSigners();
    const QX = zeroPadValue("0x01", 32);
    const QY = zeroPadValue("0x02", 32);
    const TIMELOCK = 3600n;

    const WalletImpl = await ethers.getContractFactory("Wallet");
    const walletImpl = await WalletImpl.deploy();
    const Recovery = await ethers.getContractFactory("AdminGuardianRecovery");
    const recovery = await Recovery.deploy(owner.address, owner.address);
    const Factory = await ethers.getContractFactory("WalletFactory");
    const factory = await Factory.deploy(
      await walletImpl.getAddress(),
      await recovery.getAddress(),
      TIMELOCK,
      owner.address
    );
    const salt = ethers.id("wallet-userop-batch");
    await factory.createAccount(QX, QY, salt);
    const walletAddress = await factory.predictAddress(salt);

    const MockToken = await ethers.getContractFactory("MockFeeToken");
    const token = await MockToken.deploy();
    const tokenAddress = await token.getAddress();
    const feeAmount = 100_000n;
    const sendAmount = 500_000n;
    await token.mint(walletAddress, feeAmount + sendAmount);

    await ethers.provider.send("hardhat_setBalance", [ENTRYPOINT, "0x1000000000000000000"]);
    await ethers.provider.send("hardhat_impersonateAccount", [ENTRYPOINT]);
    const epSigner = await ethers.getSigner(ENTRYPOINT);
    const wallet = await ethers.getContractAt("Wallet", walletAddress);
    const executionData = encodeBatch([
      buildFeeTransferCall(tokenAddress, BENEFICIARY, feeAmount),
      { target: tokenAddress, value: 0n, data: encodeErc20Transfer(RECIPIENT, sendAmount) },
    ]);
    await wallet.connect(epSigner).execute(ERC7821_BATCH_MODE, executionData);

    expect(await token.balanceOf(BENEFICIARY)).to.equal(feeAmount);
    expect(await token.balanceOf(RECIPIENT)).to.equal(sendAmount);
    expect(await token.balanceOf(walletAddress)).to.equal(0n);
  });
});
