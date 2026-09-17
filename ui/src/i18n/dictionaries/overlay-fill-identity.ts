import { assemble, type ByLang } from "./overlay-merge.js";
import { LOCALES } from "../locales.js";

function enAll(text: string): ByLang {
  const out: ByLang = {};
  for (const loc of LOCALES) {
    if (loc === "en") continue;
    out[loc] = text;
  }
  return out;
}

export const overlayFillIdentity = assemble({
  wallet: {
    connectEmail: enAll("Email"),
    homeLede: enAll("Sign in with your email. New accounts verify with a code, then a passkey."),
    continueWithGoogle: enAll("Continue with Google"),
    googleUnavailable: enAll("Google sign-in is not configured on this instance. Use email instead."),
    emailSignIn: enAll("Sign in"),
    sendEmailCode: enAll("Send code"),
    noAccountTitle: enAll("You don't have an account."),
    noAccountLede: enAll("Create a new account."),
    useDifferentEmail: enAll("Use a different email"),
    authWelcome: enAll("Welcome to Trustless Commerce"),
    authNext: enAll("Next"),
    authHaveAccount: enAll("Already have an account?"),
    authLogIn: enAll("Log in"),
    authNoAccount: enAll("Don't have an account?"),
    authSignUp: enAll("Sign up"),
    authOthers: enAll("Others"),
    authGoogle: enAll("Google"),
    authAgreePrefix: enAll("By creating an account you agree to the"),
    authAgreeAnd: enAll("and"),
    authTermsOfUse: enAll("Terms of Use"),
    authPrivacyPolicy: enAll("Privacy Policy"),
    authReadPrefix: enAll("I have read the"),
    authCreateFirstWallet: enAll("Create first wallet"),
    authChangeEmail: enAll("Change email"),
    authOtpTitle: enAll("Enter the code"),
    authLegalTitle: enAll("Create your first wallet"),
    authBiometricFailed: enAll("We couldn't sign in with biometrics."),
    authTryAgain: enAll("Try again"),
    authPairAnotherDevice: enAll("Pair with another device"),
    authPairExplain: enAll(
      "This phone does not have your passkey. Create one here, then approve it from a device that already has the account."
    ),
    authLostAllDevices: enAll("I have lost access to all my devices"),
    pairNeedIdentity: enAll("Open this page from a signed-in device, or after email lookup on this phone."),
    continueWithEmail: enAll("Email code"),
    pairFromNewDeviceLede: enAll(
      "Name this device and create a passkey. Next you will share a QR for a device that already has your wallet."
    ),
    pairScanOnExisting: enAll("Leave this page open. On the other device, follow the steps below."),
    pairShareHowTitle: enAll("On the other device"),
    pairShareStep1: enAll("Unlock the wallet that already has this account."),
    pairShareStep2: enAll("Open Security."),
    pairShareStep3: enAll("Choose Scan pairing QR code."),
    pairShareStep4: enAll("Scan this QR, or paste the pairing link if the camera cannot open."),
    pairShareStep5: enAll("Add this passkey. This page continues when pairing finishes."),
    pairAdded: enAll("This passkey is now on your identity."),
    pairDoneReturn: enAll("Return to the new device and log in to the wallet."),
    pairOnChainSigning: enAll(
      "You may confirm twice — once to authorize the new key, then to submit the transaction."
    ),
    pairOffChainHint: enAll(
      "This adds the new passkey to your identity. This instance has no identity store, so no chain transaction is sent."
    ),
    pairConfirmAdd: enAll("Add this passkey"),
    pairAdding: enAll("Adding passkey…"),
    pairNewKey: enAll("New passkey"),
    pairSubmitting: enAll("Submitting transaction…"),
    pairPageLede: enAll(
      "Name this device and create a passkey. Next you will share a QR for a device that already has your wallet."
    ),
    scanPairingQr: enAll("Scan pairing QR code"),
    pasteUrlInstead: enAll("Paste URL instead"),
    pairLinkCopy: enAll("Copy link"),
    pairTxExecuted: enAll("Transaction executed"),
    youArePaired: enAll("You are paired."),
    pairLoginHint: enAll("This device can now open the wallet. Log in with the passkey you just created."),
    pairLoggingIn: enAll("Logging in…"),
    pairOpenWallet: enAll("Log in to wallet"),
    pairStillWaiting: enAll(
      "If you already added this passkey on the other device, tap Check now — or log in if this page never continues."
    ),
    pairCheckNow: enAll("Check now"),
    pairChecking: enAll("Checking…"),
    pairNotReady: enAll("The other device has not confirmed this passkey yet."),
    pairWizardWhat: enAll("Setup"),
    pairWizardPaired: enAll("Paired"),
    pairOnChainHint: enAll(
      "This adds the new passkey to your identity. Confirm with this device’s passkey. Your open wallet pays the bundler fee. You may confirm twice."
    ),
    pairPasteUrlPlaceholder: enAll("Paste the pairing URL"),
    pairStep1: enAll("Scan the QR from the new device, or paste the pairing link."),
    scannerUnavailable: enAll("Camera unavailable — paste the pairing URL below."),
    close: enAll("Close"),
    logOutIdentity: enAll("Sign out"),
    identityRestoreToggle: enAll("Turn off email restore"),
    identityRestoreToggleHint: enAll(
      "Email restore is on. Turn it off only from a crypto wallet already on this identity — that transaction is sent directly, not through the bundler."
    ),
    identityRecoveryEmailTitle: enAll("Recovery email"),
    identityRecoveryEmailBody: enAll(
      "{email} is the email on this identity. Use it to restore access if you lose your devices."
    ),
    identityRecoveryEmailFallback: enAll(
      "Your identity email is already the recovery email. Use it on Recover if you lose your devices."
    ),
    identityRestoreOnHint: enAll(
      "Email restore is on. Turn it off only from a crypto wallet already on this identity — that transaction is sent directly, not through the bundler."
    ),
    identityRestoreTurnOff: enAll("Turn off email restore"),
    identityRestoreNeedEoa: enAll("Connect a crypto wallet on this identity first."),
    identityRestoreOff: enAll(
      "Email restore is off. Recover with another passkey, YubiKey, or crypto wallet."
    ),
    securityPageLedeIdentity: enAll(
      "Manage trusted devices. Your identity email is already the recovery email."
    ),
    recoveryMethodsHintIdentity: enAll(
      "Your identity email is already the recovery email. Pair another device or a security key as backup."
    ),
    openWithYubiKey: enAll("Open with YubiKey"),
    openWithCrypto: enAll("Open with crypto wallet"),
    createPasskeyForEmail: enAll("Create a passkey for this email"),
    createPageTitle: enAll("Create another wallet"),
    createPageLede: enAll("Name this wallet. It uses your current identity — no new passkey."),
    walletName: enAll("Wallet name"),
    walletNameHint: enAll("Shown in your wallet list."),
    walletNamePlaceholder: enAll("Operations"),
    defaultWalletName: enAll("Wallet"),
    renameWallet: enAll("Rename wallet"),
    createWallet: enAll("Create"),
    creatingWallet: enAll("Creating…"),
    createNeedSignIn: enAll("Unlock a wallet on this device first."),
    createNeedPasskey: enAll("Create a passkey on this identity before adding another wallet."),
    identityUnavailable: enAll(
      "Email sign-in is not available yet. Restart the commerce API after rebuilding."
    ),
    identityPasskeyExists: enAll("This email already has a passkey. Unlock with it or pair a new device."),
    passkeyFailed: enAll("Passkey failed or was cancelled. Try Create passkey again."),
    devOtpFilled: enAll("Local development filled the code. Check spam if you expected email."),
    recoverTabWithoutEmail: enAll("Other keys"),
    recoverOtherTabLede: enAll(
      "Prove a YubiKey or crypto wallet already on this identity, then add a passkey on this device."
    ),
    recoverOtherChooseLede: enAll("Choose the key you still have."),
    recoverOtherYubiKeyBody: enAll("Tap the security key that is already on this identity."),
    recoverOtherEoaBody: enAll("Connect the crypto wallet already linked to this identity."),
    recoverOtherStepChoose: enAll("Key"),
    recoverOtherStepProve: enAll("Prove"),
    recoverOtherStepWallets: enAll("Wallets"),
    recoverOtherStepPasskey: enAll("Passkey"),
    recoverOtherStepSubmit: enAll("Pay"),
    recoverOtherProveYubiKey: enAll(
      "Insert the registered YubiKey. The browser will ask for that security key once on this step, then the proof is reused to add a passkey."
    ),
    recoverOtherProveEoa: enAll("Connect and sign with the crypto wallet already on this identity."),
    recoverOtherProveCta: enAll("Prove ownership"),
    recoverOtherIdentityEmail: enAll("Identity email"),
    recoverOtherPayTitle: enAll("Who pays for recovery"),
    recoverOtherPaySelf: enAll("I submit the transaction myself"),
    recoverOtherPaySelfBody: enAll("Your connected wallet pays gas and adds the new passkey on-chain."),
    recoverOtherPayWallet: enAll("Pay with a selected wallet"),
    recoverOtherPayWalletBody: enAll(
      "Use USDC in one of your identity wallets. The bundler submits the transaction."
    ),
    recoverOtherPayRelayer: enAll("Relayer pays"),
    recoverOtherPayRelayerBody: enAll("The operator submits the transaction. Rate-limited to prevent abuse."),
    recoverOtherDone: enAll("A passkey was added. You can open your wallets on this device."),
    recoverRestoreDisabled: enAll("Email recovery is disabled for this identity. Use another key."),
    recoverNeedOtherKey: enAll("That key is not on this identity."),
    recoverPageLede: enAll(
      "Recover with the email on the identity, or prove a YubiKey or crypto wallet you already added."
    ),
    removeConfirmOnChain: enAll(
      "Remove this device’s passkey from your identity? This wallet pays the network fee ({fee})."
    ),
    removeNeedStore: enAll("This instance has no identity store, so keys cannot be removed on-chain."),
    removeNeedBundler: enAll(
      "The bundler fee token is not configured, so this wallet cannot pay to remove a key on-chain."
    ),
    removeNeedDeployed: enAll(
      "This wallet is not on-chain yet. Send USDC in so it can activate and pay the network fee, then try again."
    ),
    removeNeedFunds: enAll("Add {fee} to this wallet to pay the network fee for removing this key."),
    removeNeedIdentityOnChain: enAll(
      "This identity is not registered on the identity store, so keys cannot be removed on-chain."
    ),
    removeNeedOnChainMethod: enAll(
      "This passkey is not on the identity contract, so it cannot be removed on-chain."
    ),
    removeAuthInvalid: enAll(
      "This device’s passkey was not accepted for removing the key. Try again, or use the passkey you created this wallet with."
    ),
    yubiConfirmHint: enAll(
      "Security key created. Confirm with this device's passkey to add it — browsers need a new tap after the YubiKey ceremony."
    ),
    yubiConfirmCta: enAll("Confirm with this device"),
    retry: enAll("Retry"),
    addYubiStepPin: enAll("Connect key"),
    addYubiStepRegister: enAll("Register"),
    addYubiStepDone: enAll("Done"),
    addYubiPinLede: enAll("Insert your YubiKey, enter its FIDO2 PIN when asked, then tap the key."),
    addYubiEnrollCta: enAll("Connect YubiKey"),
    addYubiContinue: enAll("Continue"),
    addYubiEnrolled: enAll("Security key created. Continue to register it on-chain."),
    addYubiRegisterLede: enAll(
      "This wallet pays the bundler fee in USDC. You may confirm twice — once to authorize the key, then to submit the transaction."
    ),
    addYubiNeedFunds: enAll(
      "This wallet is not activated or does not have enough USDC ({fee}) to register the key."
    ),
    addYubiRegisterCta: enAll("Register on-chain"),
    addYubiRegistering: enAll("Registering…"),
    addYubiAdded: enAll("Security key added"),
    addYubiFailed: enAll("Could not register the security key."),
    connectWalletStepConnect: enAll("Connect"),
    connectWalletStepPay: enAll("Who pays"),
    connectWalletStepSign: enAll("Sign"),
    connectWalletStepDone: enAll("Done"),
    connectWalletConnectCta: enAll("Connect wallet"),
    connectWalletPickWallet: enAll(
      "Connect a wallet. We'll switch it to this network, then ask for an EIP-712 signature."
    ),
    connectWalletOpenPicker: enAll("Open wallet picker"),
    connectWalletNoWallet: enAll(
      "No wallet detected. Install MetaMask, Rainbow, or Coinbase Wallet, then try again."
    ),
    connectWalletWalletConnect: enAll("WalletConnect"),
    connectWalletWalletConnectHint: enAll("Rainbow, MetaMask mobile, and other WalletConnect apps."),
    connectWalletSignEip712: enAll(
      "Your wallet will ask you to sign EIP-712 typed data to prove you own this address."
    ),
    connectWalletConnected: enAll("Connected {address}"),
    connectWalletPaySelf: enAll("This wallet pays gas (DIY)"),
    connectWalletPaySelfHint: enAll("The connected account submits the transaction and pays ETH gas."),
    connectWalletPaySelfDisabled: enAll("The connected account does not have enough ETH for gas."),
    connectWalletPayBalance: enAll("Pay with my balance"),
    connectWalletPayBalanceHint: enAll("This wallet pays the bundler fee in USDC ({fee})."),
    connectWalletPayBalanceDisabled: enAll(
      "This wallet is not activated or does not have enough USDC ({fee})."
    ),
    connectWalletSignHint: enAll(
      "Confirm with this device's passkey to authorize the new wallet. The connected account then submits the transaction."
    ),
    connectWalletSignHintUserOp: enAll(
      "Confirm with this device's passkey to authorize the new wallet, then to submit the transaction."
    ),
    connectWalletSubmitCta: enAll("Confirm"),
    connectWalletSubmitting: enAll("Submitting…"),
    connectWalletAdded: enAll("Wallet added"),
    connectWalletFailed: enAll("Could not add the wallet."),
  },
});
