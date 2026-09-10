/** Deploy WalletEip712 and return a factory with the library linked. */
export async function getWalletContractFactory(ethers: any, name: string) {
  const Lib = await ethers.getContractFactory("WalletEip712");
  const lib = await Lib.deploy();
  await lib.waitForDeployment();
  return ethers.getContractFactory(name, {
    libraries: {
      WalletEip712: await lib.getAddress(),
    },
  });
}
