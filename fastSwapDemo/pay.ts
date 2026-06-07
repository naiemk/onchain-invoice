import { Contract, JsonRpcProvider, Wallet, getAddress, isAddress, parseUnits, NonceManager } from "ethers";
import { readFile } from "node:fs/promises";
import { ERC20_ABI } from "../src/abis.js";
import { DEMO_DEPLOYMENT_PATH } from "./deploy.js";
import { API_PORT, DEMO_HOST, deploymentChains, type DemoChainDeployment, type DemoDeployment } from "./config.js";

const ERC20_TRANSFER_ABI = [
  ...ERC20_ABI,
  "function transfer(address to,uint256 amount) returns (bool)",
  "function mint(address to,uint256 amount)",
] as const;

const HARDHAT_ACCOUNTS = [
  {
    aliases: ["deployer", "alice", "account0", "0"],
    address: "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266",
    privateKey: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  },
  {
    aliases: ["bob", "account1", "1"],
    address: "0x70997970c51812dc3a010c7d01b50e0d17dc79c8",
    privateKey: "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  },
  {
    aliases: ["carol", "account2", "2"],
    address: "0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc",
    privateKey: "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
  },
];

type HardhatAccount = (typeof HARDHAT_ACCOUNTS)[number];

type PayArgs = {
  to?: string;
  amount?: string;
  symbol?: string;
  from: string;
  network: string;
  invoiceId?: string;
};

export async function pay(args: PayArgs) {
  const deployment = JSON.parse(await readFile(DEMO_DEPLOYMENT_PATH, "utf8")) as DemoDeployment;
  if (args.invoiceId) {
    await payInvoice(deployment, args.invoiceId, args.from);
    return;
  }

  if (!args.to || !args.amount || !args.symbol) usage();
  const chain = resolveChain(deployment, args.network);
  const provider = new JsonRpcProvider(chain.rpcUrl);
  const wallet = new NonceManager(new Wallet(resolvePrivateKey(args.from), provider));
  const to = getAddress(args.to);
  const token = resolveToken(chain, args.symbol);
  const amount = parseUnits(args.amount, token.decimals);

  if (token.address === "native") {
    const tx = await wallet.sendTransaction({ to, value: amount });
    const receipt = await tx.wait();
    console.log(`[fastswap-demo:pay] sent ${args.amount} ${token.symbol} on ${chain.name}`);
    console.log(`[fastswap-demo:pay] from ${await wallet.getAddress()} to ${to}`);
    console.log(`[fastswap-demo:pay] tx ${receipt?.hash ?? tx.hash}`);
    return;
  }

  const erc20 = new Contract(token.address, ERC20_TRANSFER_ABI, wallet);
  const from = await wallet.getAddress();
  const balance = await erc20.balanceOf(from);
  if (balance < amount) {
    await (await erc20.mint(from, amount - balance)).wait();
    console.log(`[fastswap-demo:pay] minted ${token.symbol} demo funds for ${from}`);
  }
  const tx = await erc20.transfer(to, amount);
  const receipt = await tx.wait();
  console.log(`[fastswap-demo:pay] sent ${args.amount} ${token.symbol} on ${chain.name}`);
  console.log(`[fastswap-demo:pay] from ${from} to ${to}`);
  console.log(`[fastswap-demo:pay] token ${token.address}`);
  console.log(`[fastswap-demo:pay] tx ${receipt?.hash ?? tx.hash}`);
}

async function payInvoice(deployment: DemoDeployment, invoiceId: string, from: string) {
  const response = await fetch(`http://${DEMO_HOST}:${API_PORT}/invoices/${encodeURIComponent(invoiceId)}`);
  if (!response.ok) throw new Error(`Invoice ${invoiceId} not found: ${response.statusText}`);
  const invoice = (await response.json()) as {
    invoiceId: string;
    invoiceAddress: string;
    sourceChainId: string;
    token?: string;
    sourceToken: string;
    amount: string;
  };
  const chain = resolveChain(deployment, invoice.sourceChainId);
  const provider = new JsonRpcProvider(chain.rpcUrl);
  const wallet = new NonceManager(new Wallet(resolvePrivateKey(from), provider));
  const tokenAddress = invoice.token ?? invoice.sourceToken;
  const amount = BigInt(invoice.amount);
  const fromAddress = await wallet.getAddress();

  if (tokenAddress === "0x0000000000000000000000000000000000000000") {
    const tx = await wallet.sendTransaction({ to: invoice.invoiceAddress, value: amount });
    const receipt = await tx.wait();
    console.log(`[fastswap-demo:pay] paid invoice ${invoice.invoiceId} with native ${chain.nativeSymbol} on ${chain.name}`);
    console.log(`[fastswap-demo:pay] from ${fromAddress} to ${invoice.invoiceAddress}`);
    console.log(`[fastswap-demo:pay] amountWei ${amount}`);
    console.log(`[fastswap-demo:pay] tx ${receipt?.hash ?? tx.hash}`);
    return;
  }

  const erc20 = new Contract(tokenAddress, ERC20_TRANSFER_ABI, wallet);
  const balance = await erc20.balanceOf(fromAddress);
  if (balance < amount) {
    await (await erc20.mint(fromAddress, amount - balance)).wait();
    console.log(`[fastswap-demo:pay] minted invoice token demo funds for ${fromAddress}`);
  }
  const tx = await erc20.transfer(invoice.invoiceAddress, amount);
  const receipt = await tx.wait();
  console.log(`[fastswap-demo:pay] paid invoice ${invoice.invoiceId} with token on ${chain.name}`);
  console.log(`[fastswap-demo:pay] from ${fromAddress} to ${invoice.invoiceAddress}`);
  console.log(`[fastswap-demo:pay] token ${tokenAddress}`);
  console.log(`[fastswap-demo:pay] amount ${amount}`);
  console.log(`[fastswap-demo:pay] tx ${receipt?.hash ?? tx.hash}`);
}

function resolveChain(deployment: DemoDeployment, network: string): DemoChainDeployment {
  const normalized = network.toLowerCase();
  const chain = deploymentChains(deployment).find(
    (candidate) => [candidate.id, candidate.name].some((value) => value.toLowerCase() === normalized)
  );
  if (chain) return chain;
  throw new Error(`Unknown network "${network}". Use one of: ${deploymentChains(deployment).map((chain) => `${chain.name} (${chain.id})`).join(", ")}.`);
}

function resolveToken(chain: DemoChainDeployment, symbol: string) {
  const normalized = symbol.toLowerCase();
  if (normalized === "eth" || normalized === chain.nativeSymbol.toLowerCase()) {
    return { symbol: chain.nativeSymbol, address: "native", decimals: 18 };
  }
  if (normalized === chain.tokens.stable.symbol.toLowerCase()) {
    return chain.tokens.stable;
  }
  throw new Error(`Token ${symbol} is not deployed on ${chain.name}. Use ${chain.nativeSymbol} or ${chain.tokens.stable.symbol}.`);
}

function resolvePrivateKey(from: string): string {
  if (/^0x[0-9a-fA-F]{64}$/.test(from)) return from;
  const account = resolveAccount(from);
  if (!account && isAddress(from)) {
    throw new Error(`Known demo address ${from} has no configured private key. Use a Hardhat alias or raw private key.`);
  }
  if (!account) {
    throw new Error(`Unknown --from "${from}". Use deployer, alice, bob, account0, account1, or a private key.`);
  }
  return account.privateKey;
}

function resolveAccount(from: string): HardhatAccount | undefined {
  const normalized = from.toLowerCase();
  return HARDHAT_ACCOUNTS.find(
    (candidate) => candidate.aliases.includes(normalized) || candidate.address.toLowerCase() === normalized
  );
}

function listAddresses() {
  console.log("Available demo --from addresses:");
  for (const account of HARDHAT_ACCOUNTS) {
    console.log(`- ${account.aliases.join(", ")}`);
    console.log(`  address:    ${getAddress(account.address)}`);
    console.log(`  privateKey: ${account.privateKey}`);
  }
}

function parseArgs(argv: string[]): PayArgs {
  if (argv.includes("--list-addresses")) {
    listAddresses();
    process.exit(0);
  }

  if (argv[0] === "--invoice" && argv[1]) {
    let from = "deployer";
    for (let i = 2; i < argv.length; i++) {
      const arg = argv[i];
      const value = argv[i + 1];
      if (arg === "--from" && value) {
        from = value;
        i++;
      } else {
        usage();
      }
    }
    return { invoiceId: argv[1], from, network: "" };
  }

  const [to, amount, symbol, ...rest] = argv;
  if (!to || !amount || !symbol) usage();

  let from = "deployer";
  let network = "AliceChain";

  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    const value = rest[i + 1];
    if (arg === "--from" && value) {
      from = value;
      i++;
    } else if (arg === "--network" && value) {
      network = value;
      i++;
    } else {
      usage();
    }
  }

  return { to, amount, symbol, from, network };
}

function usage(): never {
  throw new Error(
    [
      "Usage:",
      "  fastSwapDemo/pay.sh <to_address> <amount> <token> --from <from> --network <networkName|chainId>",
      "  fastSwapDemo/pay.sh --invoice <invoiceId> --from <from>",
      "  fastSwapDemo/pay.sh --list-addresses",
      "",
      "Examples:",
      "  fastSwapDemo/pay.sh 0xInvoice 5 ETH --from alice --network AliceChain",
      "  fastSwapDemo/pay.sh 0xInvoice 5 DumUSDT --from deployer --network AliceChain",
      "  fastSwapDemo/pay.sh 0xInvoice 5 BobUSDC --from bob --network BobChain",
      "  fastSwapDemo/pay.sh --invoice 0xInvoiceId --from alice",
    ].join("\n")
  );
}

if (process.argv[1]?.endsWith("pay.js")) {
  await pay(parseArgs(process.argv.slice(2)));
}
