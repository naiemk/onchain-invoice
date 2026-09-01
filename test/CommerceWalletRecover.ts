import { expect } from "chai";
import { ethers as ethersLib } from "ethers";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../commerce/server/app.js";
import { loadConfig } from "../commerce/server/config.js";
import { resetRateLimitBuckets } from "../commerce/server/rate-limit.js";
import { deriveWalletSalt, predictWalletAddress } from "../commerce/shared/wallet-address.js";

const FACTORY = "0x06964dE197ed29A4DC2D34F68aD4510Afa25f537";
const IMPL = "0xe024cE8ed1878dBdd3ca8E73B1e586c4E46dC85C";
const QX = ethersLib.zeroPadValue("0x0c", 32);
const QY = ethersLib.zeroPadValue("0x0d", 32);

const BASE_ENV = {
  PORT: "0",
  ADMIN_API_KEY: "admin-wallet-recover",
  SWEEPER_API_KEY: "sweeper-wallet-recover",
  WALLET_FACTORY_ADDRESS: FACTORY,
  WALLET_IMPLEMENTATION_ADDRESS: IMPL,
  WALLET_RECOVERY_ADDRESS: "0x72739889bcce2B08a23212bae6C7B9F1C29e7873",
  WALLET_RPC_URL: "",
  EVM_RPC_URL: "",
  TURNSTILE_SECRET: "",
} as const;

describe("commerce wallet recover-info API", function () {
  it("returns inDb and deployed flags", async function () {
    resetRateLimitBuckets();
    const dir = await mkdtemp(join(tmpdir(), "commerce-wallet-recover-"));
    const salt = deriveWalletSalt(QX, QY);
    const address = predictWalletAddress(FACTORY, IMPL, salt);

    const config = loadConfig({
      ...process.env,
      ...BASE_ENV,
      DB_PATH: join(dir, "test.db"),
    } as NodeJS.ProcessEnv);
    const app = createApp(config);
    await new Promise<void>((resolve) => {
      app.server.listen(0, "127.0.0.1", () => resolve());
    });
    const addr = app.server.address();
    if (!addr || typeof addr === "string") throw new Error("expected TCP address");
    const baseUrl = `http://127.0.0.1:${addr.port}`;

    try {
      await fetch(`${baseUrl}/api/wallet/accounts`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          address,
          salt,
          ownerQx: QX,
          ownerQy: QY,
          credentialId: "cred-recover",
        }),
      });

      const missing = await fetch(
        `${baseUrl}/api/wallet/accounts/0x0000000000000000000000000000000000000001/recover-info?chainId=11155111`
      );
      expect(missing.status).to.equal(200);
      const missingBody = (await missing.json()) as { inDb: boolean; deployed: boolean };
      expect(missingBody.inDb).to.equal(false);

      const info = await fetch(
        `${baseUrl}/api/wallet/accounts/${address}/recover-info?chainId=11155111`
      );
      expect(info.status).to.equal(200);
      const body = (await info.json()) as { inDb: boolean; account: { ownerQx: string } | null };
      expect(body.inDb).to.equal(true);
      expect(body.account?.ownerQx).to.equal(QX);

      const challenge = await fetch(`${baseUrl}/api/wallet/recovery/challenges`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ purpose: "record", walletAddress: address }),
      });
      expect(challenge.status).to.equal(201);
    } finally {
      await app.close();
      await rm(dir, { recursive: true, force: true });
    }
  });
});
