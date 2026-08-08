/**
 * Initialize (or skip) the commerce-invoice config PDA on Devnet.
 * Invoked by solana/scripts/deploy-devnet.sh after program deploy.
 */
import fs from "node:fs";
import path from "node:path";
import { Connection, Keypair } from "@solana/web3.js";
import { CommerceSolanaSdk, solanaConfigPda } from "../../src/solana-sdk";

async function main(): Promise<void> {
  const rpc = process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com";
  const programId = process.env.SOLANA_PROGRAM_ID;
  const authPath = process.env.SOLANA_AUTHORITY_KEYPAIR;
  const feeRecipient = process.env.SOLANA_FEE_RECIPIENT;
  const feeBps = Number(process.env.SOLANA_FEE_BPS ?? "50");
  const artifact = process.env.SOLANA_DEPLOY_ARTIFACT ?? "solana/data/commerce-deploy-devnet.json";

  if (!programId || !authPath || !feeRecipient) {
    throw new Error("SOLANA_PROGRAM_ID, SOLANA_AUTHORITY_KEYPAIR, SOLANA_FEE_RECIPIENT required");
  }

  const authority = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(authPath, "utf8"))));
  const connection = new Connection(rpc, "confirmed");
  const [configPda] = solanaConfigPda(programId);
  const sdk = new CommerceSolanaSdk({
    connection,
    programId,
    authority,
    feeRecipient,
    feeBps,
  });

  const info = await connection.getAccountInfo(configPda);
  let initializeTx: string | undefined;
  if (info) {
    console.log("config PDA already exists:", configPda.toBase58());
  } else {
    initializeTx = await sdk.initialize();
    console.log("initialize tx:", initializeTx);
  }

  const payload = {
    network: "devnet",
    rpcUrl: rpc,
    programId,
    authority: authority.publicKey.toBase58(),
    feeRecipient,
    feeBps,
    configPda: configPda.toBase58(),
    initializeTx: initializeTx ?? null,
  };
  fs.mkdirSync(path.dirname(artifact), { recursive: true });
  fs.writeFileSync(artifact, `${JSON.stringify(payload, null, 2)}\n`);
  console.log(JSON.stringify(payload, null, 2));
  console.log("Wrote", artifact);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
