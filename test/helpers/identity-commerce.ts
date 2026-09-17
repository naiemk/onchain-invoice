import { ethers as ethersLib } from "ethers";
import { clearLastDevOtp, getLastDevOtp } from "../../commerce/server/email.js";
import { cookieHeaderFromResponse } from "../../commerce/server/identity-session.js";

export async function createIdentityWalletViaApi(
  baseUrl: string,
  input: {
    email: string;
    qx: string;
    qy: string;
    credentialId: string;
    captchaToken?: string;
  }
): Promise<{
  cookie: string;
  identityId: string;
  address: string;
  salt: string;
  ownerQx: string;
  ownerQy: string;
  credentialId: string;
}> {
  clearLastDevOtp();
  const start = await fetch(`${baseUrl}/api/identity/email/start`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: input.email, captchaToken: input.captchaToken }),
  });
  if (start.status !== 200) {
    throw new Error(`identity email start failed: ${start.status} ${await start.text()}`);
  }
  const otp = getLastDevOtp();
  if (!otp?.code) throw new Error("dev OTP not captured");
  const verify = await fetch(`${baseUrl}/api/identity/email/verify`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: input.email, code: otp.code }),
  });
  if (verify.status !== 200) {
    throw new Error(`identity email verify failed: ${verify.status} ${await verify.text()}`);
  }
  const verified = (await verify.json()) as { identityId: string };
  const cookie = cookieHeaderFromResponse(verify);
  const reg = await fetch(`${baseUrl}/api/identity/passkey/register`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({
      qx: input.qx,
      qy: input.qy,
      credentialId: input.credentialId,
    }),
  });
  if (reg.status !== 201) {
    throw new Error(`passkey register failed: ${reg.status} ${await reg.text()}`);
  }
  const body = (await reg.json()) as {
    identityId: string;
    wallets: { address: string; salt: string }[];
  };
  const account = body.wallets[0];
  if (!account) throw new Error("passkey register did not create a wallet");
  return {
    cookie,
    identityId: body.identityId || verified.identityId,
    address: account.address,
    salt: account.salt,
    ownerQx: input.qx,
    ownerQy: input.qy,
    credentialId: input.credentialId,
  };
}

export function syntheticPasskey(index: number): { qx: string; qy: string; credentialId: string } {
  return {
    qx: ethersLib.zeroPadValue(ethersLib.toBeHex(index + 1), 32),
    qy: ethersLib.zeroPadValue(ethersLib.toBeHex(index + 101), 32),
    credentialId: `cred-identity-${index}`,
  };
}
