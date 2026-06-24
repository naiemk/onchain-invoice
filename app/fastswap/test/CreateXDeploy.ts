import { expect } from "chai";
import { ContractFactory, getCreate2Address, keccak256 } from "ethers";
import { hashDeploySalt, resolveDeploySalts } from "../config/salts.js";
import { CREATEX_ADDRESS, predictCreateXAddress, buildInitCode } from "../cli/createx.js";
import { readArtifact } from "../cli/artifacts.js";

describe("CreateX deployment", function () {
  const spec = { namespace: "fastswap", version: "1" };
  const salts = resolveDeploySalts(spec);

  it("derives stable bytes32 salts from namespace and version", function () {
    const a = hashDeploySalt("fastswap", "1", "invoiceSweeper");
    const b = hashDeploySalt("fastswap", "1", "invoiceSweeper");
    expect(a).to.equal(b);
    expect(a).to.match(/^0x[0-9a-f]{64}$/);
    expect(salts.fastSwapImplementation).to.not.equal(salts.fastSwapProxy);
  });

  it("predicts the same address as standard CREATE2 with CreateX as deployer", async function () {
    const sweeper = await readArtifact("contracts/InvoiceSweeper.sol/InvoiceSweeper.json");
    const initCode = await buildInitCode(sweeper, ["0x00000000000000000000000000000000000000c0"]);

    const predicted = predictCreateXAddress(CREATEX_ADDRESS, salts.invoiceSweeper, initCode);
    const expected = getCreate2Address(CREATEX_ADDRESS, salts.invoiceSweeper, keccak256(initCode));
    expect(predicted).to.equal(expected);
  });

  it("uses distinct salts for each stack contract", async function () {
    const [fastSwap, proxy, sweeper, liquidityManager] = await Promise.all([
      readArtifact("contracts/fastswap/FastSwapReceiver.sol/FastSwapReceiver.json"),
      readArtifact("contracts/proxy/ReceiverProxy.sol/ReceiverProxy.json"),
      readArtifact("contracts/InvoiceSweeper.sol/InvoiceSweeper.json"),
      readArtifact("contracts/liquiditymanager/LiquidityManager.sol/LiquidityManager.json"),
    ]);

    const owner = "0x000000000000000000000000000000000000dEaD";
    const fastSwapFactory = new ContractFactory(fastSwap.abi, fastSwap.bytecode);
    const initData = fastSwapFactory.interface.encodeFunctionData("initialize", [owner]);

    const fastSwapImplInit = await buildInitCode(fastSwap);
    const fastSwapImpl = predictCreateXAddress(CREATEX_ADDRESS, salts.fastSwapImplementation, fastSwapImplInit);

    const proxyInit = await buildInitCode(proxy, [fastSwapImpl, initData]);
    const fastSwapProxy = predictCreateXAddress(CREATEX_ADDRESS, salts.fastSwapProxy, proxyInit);

    const sweeperInit = await buildInitCode(sweeper, [fastSwapProxy]);
    const sweeperAddress = predictCreateXAddress(CREATEX_ADDRESS, salts.invoiceSweeper, sweeperInit);

    const lmFactory = new ContractFactory(liquidityManager.abi, liquidityManager.bytecode);
    const lmInitData = lmFactory.interface.encodeFunctionData("initialize", [owner]);
    const lmImplInit = await buildInitCode(liquidityManager);
    const lmImpl = predictCreateXAddress(CREATEX_ADDRESS, salts.liquidityManagerImplementation, lmImplInit);
    const lmProxyInit = await buildInitCode(proxy, [lmImpl, lmInitData]);
    const lmProxy = predictCreateXAddress(CREATEX_ADDRESS, salts.liquidityManagerProxy, lmProxyInit);

    const addresses = [fastSwapImpl, fastSwapProxy, sweeperAddress, lmImpl, lmProxy];
    expect(new Set(addresses).size).to.equal(addresses.length);
  });
});
