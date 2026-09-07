import { expect } from "chai";
import { selectPubkeyForCredential, isPoisonedDeviceRow } from "../ui/src/shared/wallet-passkey-bind.js";

const ACCOUNT = {
  ownerQx: `0x${"aa".repeat(32)}`,
  ownerQy: `0x${"bb".repeat(32)}`,
  credentialId: "cred-original",
};

describe("wallet passkey bind", function () {
  it("treats first-owner coords on a different credentialId as poisoned", function () {
    expect(
      isPoisonedDeviceRow(
        { credentialId: "cred-other", ownerQx: ACCOUNT.ownerQx, ownerQy: ACCOUNT.ownerQy },
        ACCOUNT
      )
    ).to.equal(true);
    expect(
      isPoisonedDeviceRow(
        { credentialId: "cred-original", ownerQx: ACCOUNT.ownerQx, ownerQy: ACCOUNT.ownerQy },
        ACCOUNT
      )
    ).to.equal(false);
    expect(
      isPoisonedDeviceRow(
        {
          credentialId: "cred-other",
          ownerQx: `0x${"11".repeat(32)}`,
          ownerQy: `0x${"22".repeat(32)}`,
        },
        ACCOUNT
      )
    ).to.equal(false);
  });

  it("prefers roster and registry over a poisoned device row", function () {
    const poisoned = {
      credentialId: "cred-other",
      ownerQx: ACCOUNT.ownerQx,
      ownerQy: ACCOUNT.ownerQy,
    };
    const realQx = `0x${"cc".repeat(32)}`;
    const realQy = `0x${"dd".repeat(32)}`;

    expect(
      selectPubkeyForCredential({
        credentialId: "cred-other",
        account: ACCOUNT,
        devices: [poisoned],
        rosterKeys: [{ credentialId: "cred-other", qx: realQx, qy: realQy }],
      })
    ).to.deep.equal({ qx: realQx, qy: realQy, source: "roster" });

    expect(
      selectPubkeyForCredential({
        credentialId: "cred-other",
        account: ACCOUNT,
        devices: [poisoned],
        registry: { credentialId: "cred-other", qx: realQx, qy: realQy },
      })
    ).to.deep.equal({ qx: realQx, qy: realQy, source: "registry" });
  });

  it("does not pack first-owner qx for a poisoned credential", function () {
    const picked = selectPubkeyForCredential({
      credentialId: "cred-other",
      account: ACCOUNT,
      devices: [
        { credentialId: "cred-other", ownerQx: ACCOUNT.ownerQx, ownerQy: ACCOUNT.ownerQy },
      ],
      session: { credentialId: "cred-other", qx: ACCOUNT.ownerQx, qy: ACCOUNT.ownerQy },
    });
    expect(picked).to.deep.equal({ qx: "", qy: "", source: "poisoned_device_row" });
  });

  it("uses the original device row when credential matches the account", function () {
    expect(
      selectPubkeyForCredential({
        credentialId: "cred-original",
        account: ACCOUNT,
        devices: [
          { credentialId: "cred-original", ownerQx: ACCOUNT.ownerQx, ownerQy: ACCOUNT.ownerQy },
        ],
      })
    ).to.deep.equal({ qx: ACCOUNT.ownerQx, qy: ACCOUNT.ownerQy, source: "device" });
  });
});
