import { expect } from "chai";
import { ZeroAddress } from "ethers";
import { selectPubkeyForCredential, isPoisonedDeviceRow } from "../ui/src/shared/wallet-passkey-bind.js";
import { collectRosterEntityIds, passkeyKeyIdCandidates } from "../ui/src/shared/wallet-passkey-bind.js";
import { computeKeyId, KEY_WEBAUTHN, KEY_YUBIKEY } from "../commerce/shared/advanced-wallet.js";

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

describe("super wallet passkey entity probe", function () {
  it("collects unique entity ids from roster entities and keys", function () {
    const admin = `0x${"aa".repeat(32)}`;
    const teammate = `0x${"bb".repeat(32)}`;
    expect(
      collectRosterEntityIds(
        [{ entityId: admin }, { entityId: teammate }],
        [{ entityId: admin }, { entityId: teammate }]
      )
    ).to.deep.equal([admin, teammate]);
  });

  it("computes webauthn then yubikey key ids for each entity", function () {
    const entity = `0x${"11".repeat(32)}`;
    const qx = `0x${"cc".repeat(32)}`;
    const qy = `0x${"dd".repeat(32)}`;
    const candidates = passkeyKeyIdCandidates([entity], qx, qy);
    expect(candidates).to.have.length(2);
    expect(candidates[0]).to.deep.equal({
      entityId: entity,
      keyType: KEY_WEBAUTHN,
      keyId: computeKeyId(entity, KEY_WEBAUTHN, qx, qy, ZeroAddress),
    });
    expect(candidates[1]).to.deep.equal({
      entityId: entity,
      keyType: KEY_YUBIKEY,
      keyId: computeKeyId(entity, KEY_YUBIKEY, qx, qy, ZeroAddress),
    });
  });
});
