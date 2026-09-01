import fs from "fs";
import path from "path";

const dir = "ui/src/i18n/dictionaries";
const enText = fs.readFileSync(path.join(dir, "wallet-en.ts"), "utf8");

function extractKey(text, key) {
  const re = new RegExp(`^\\s+${key}:\\s*([\\s\\S]*?)(?:,\\n)(?=\\s+\\w+:|\\s*\\};)`, "m");
  const m = text.match(re);
  if (!m) throw new Error(`missing ${key}`);
  return m[1].trim();
}

/** Keys to copy from wallet-en.ts when absent in other locales (English fallback). */
const keysToSync = [
  "unlockWrongWallet",
  "openWalletFailed",
  "fundsSafeAtAddress",
  "walletNeedsPasskeyUnlock",
  "superWalletRestoreEmailTitle",
  "superWalletRestoreEmailHint",
  "superWalletRestoreEmailCta",
  "chooseWalletLede",
  "passkeyMissingOnDevice",
  "passkeyPromptPending",
  "passkeyCancelled",
  "passkeyAuthenticatorBusy",
  "passkeyNotSupported",
  "passkeySecurityBlocked",
  "passkeyTimeout",
  "passkeyCreationCancelled",
  "passkeySigningCancelled",
  "yubikeyPinRequiredTitle",
  "yubikeyPinRequiredWhy",
  "yubikeyPinSetupSteps",
  "yubikeyPinNeverStored",
  "inviteTeammate",
  "inviteTeammateHint",
  "scanToJoinSuper",
  "joinSuperTitle",
  "joinSuperLede",
  "joinSuperEmail",
  "joinSuperPasskey",
  "joinSuperPasskeyLabel",
  "joinSuperYubiKey",
  "joinSuperYubiKeyLabel",
  "joinSuperEoa",
  "joinSuperWaiting",
  "joinSuperSubmitting",
  "joinSuperApproved",
  "joinSuperRejected",
  "joinSuperTimeout",
  "joinSuperEntityMissing",
  "joinSuperNotAdvanced",
  "joinSuperNotAdvancedHint",
  "enrollmentPendingTitle",
  "enrollmentPendingEmpty",
  "enrollmentApprove",
  "enrollmentReject",
  "addSecurityKey",
  "addSecurityKeyHint",
  "signWithSecurityKey",
  "keyPublicPasskey",
  "keyPublicEoa",
  "keyPublicHint",
  "advancedDevicesBodySuper",
  "advancedDevicesBodySimple",
  "lock",
  "allWallets",
  "emailAttachHint",
  "emailAttachCta",
  "testnetAddressWarning",
  "showAddressQr",
  "addressQrTitle",
  "viewAddressExplorer",
  "viewTxExplorer",
  "sendScanTitle",
  "sendScanHint",
  "cashPartnersTitle",
  "cashPartnersBody",
  "otherDevicesHint",
  "noticeDismiss",
  "noticePrev",
  "noticeNext",
  "networkMismatchLede",
  "networkMismatchBody",
  "createAcceptTerms",
  "createAcceptSecurityChecks",
  "createDisclaimerStep1Title",
  "createDisclaimerStep1Body",
  "createDisclaimerStep2Title",
  "createDisclaimerStep2Body",
  "createDisclaimerStep3Title",
  "createDisclaimerStep3Body",
  "createDisclaimerProgress",
  "createDisclaimerNext",
  "createDisclaimerBack",
  "createDisclaimerSkip",
  "createDisclaimerFinish",
  "createCaptchaRequired",
  "localRecoveryTitle",
  "localRecoveryLede",
  "localRecoveryChain",
  "localRecoveryLookup",
  "localRecoveryNeedAddress",
  "localRecoveryDbFound",
  "localRecoveryRetryPasskey",
  "localRecoveryDeployed",
  "localRecoveryFromChain",
  "localRecoveryUndeployed",
  "localRecoveryUndeployedFunds",
  "localRecoverySupportCta",
  "localRecoverySupportCopy",
  "localRecoveryCopy",
  "localRecoveryNeedKeys",
];

function hasKey(text, key) {
  return new RegExp(`^\\s+${key}:`, "m").test(text);
}

for (const file of fs.readdirSync(dir).filter((f) => f.startsWith("wallet-") && f !== "wallet-en.ts")) {
  const p = path.join(dir, file);
  let text = fs.readFileSync(p, "utf8");
  const missing = keysToSync.filter((k) => !hasKey(text, k));
  if (missing.length === 0) {
    console.log("skip", file);
    continue;
  }
  const insert = missing.map((k) => `  ${k}: ${extractKey(enText, k)},`).join("\n");
  if (text.includes("signInFailed:")) {
    text = text.replace(/(^\s+signInFailed:[\s\S]*?,)(\n)/m, `$1\n${insert}$2`);
  } else if (text.includes("superWalletNoSigningKey:")) {
    text = text.replace(/(^\s+superWalletNoSigningKey:[\s\S]*?,)(\n)/m, `$1\n${insert}$2`);
  } else {
    text = text.replace(/\n\};\s*$/, `\n${insert}\n};\n`);
  }
  fs.writeFileSync(p, text);
  console.log("patched", file, missing.join(", "));
}
