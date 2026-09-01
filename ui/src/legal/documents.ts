/** English legal document bodies for Trustless Commerce. */

export type LegalDocId = "terms" | "privacy" | "cookies" | "risks" | "security-checks";

export type LegalSection = {
  heading: string;
  paragraphs: string[];
  bullets?: string[];
};

export type LegalDocument = {
  id: LegalDocId;
  title: string;
  lede: string;
  lastUpdated: string;
  sections: LegalSection[];
};

export const LEGAL_LAST_UPDATED = "1 September 2026";

export const LEGAL_DOCUMENTS: Record<LegalDocId, LegalDocument> = {
  terms: {
    id: "terms",
    title: "Terms of Use",
    lede: "These Terms govern your use of Trustless Commerce software and services.",
    lastUpdated: LEGAL_LAST_UPDATED,
    sections: [
      {
        heading: "1. Agreement",
        paragraphs: [
          "These Terms of Use (\"Terms\") are a binding agreement between you and the operator of Trustless Commerce (\"we\", \"us\", \"our\"). By accessing or using our website, wallet software, invoice and pay links, Super Wallet features, merchant tools, APIs, or any related services (collectively, the \"Services\"), you agree to these Terms. If you do not agree, do not use the Services.",
        ],
      },
      {
        heading: "2. Eligibility",
        paragraphs: [
          "You must be at least 18 years old and have the legal capacity to enter into a binding contract in your jurisdiction. You may not use the Services if you are prohibited from doing so under applicable law, including sanctions or export-control restrictions.",
        ],
      },
      {
        heading: "3. The Services",
        paragraphs: [
          "Trustless Commerce provides non-custodial software for passkey-secured smart wallets, crypto invoicing, hosted checkout, optional team multisig (Super Wallet), and related business tools. We may add, change, or discontinue features at any time.",
          "The Services are software tools only. We do not hold, safeguard, or control digital assets on your behalf.",
        ],
      },
      {
        heading: "4. Not a custodian, bank, broker, or exchange",
        paragraphs: [
          "Trustless Commerce is not a bank, broker-dealer, money transmitter, custodian, or exchange. We do not take possession of your funds, cannot freeze or reverse on-chain transactions, and cannot restore access to a wallet if you lose every authorized device and have not configured recovery.",
        ],
      },
      {
        heading: "5. Wallets, passkeys, and your responsibilities",
        paragraphs: [
          "Your wallet is controlled by cryptographic keys created and stored on your device through WebAuthn (passkeys) or compatible security keys. Private keys remain on your authenticator. We store only public key coordinates, credential identifiers, and metadata needed to operate the Services.",
          "Trustless Commerce does not provide seed phrases. You are solely responsible for:",
        ],
        bullets: [
          "Keeping your devices secure and your biometrics or device PIN private.",
          "Pairing additional trusted devices before you need them.",
          "Configuring email and guardian recovery where available.",
          "Verifying recipient addresses and transaction details before signing.",
          "Understanding that Super Wallet upgrades are irreversible and disable email recovery.",
        ],
      },
      {
        heading: "6. Transactions",
        paragraphs: [
          "Blockchain transactions are generally irreversible. You are responsible for network fees and for ensuring you send assets on the correct chain and to the correct address. We are not responsible for user error, smart-contract behavior on third-party networks, or failures of RPC providers, bundlers, or blockchains.",
        ],
      },
      {
        heading: "7. Fees",
        paragraphs: [
          "You may pay network fees to third parties and, where disclosed, service fees to us. We may change fees with reasonable notice where practicable. Continued use after a fee change constitutes acceptance.",
        ],
      },
      {
        heading: "8. Acceptable use",
        paragraphs: ["You agree not to use the Services to:"],
        bullets: [
          "Violate any law or regulation, including anti-money-laundering and sanctions rules.",
          "Infringe intellectual property or privacy rights.",
          "Transmit malware, attempt unauthorized access, or abuse the API.",
          "Interfere with the integrity or availability of the Services.",
        ],
      },
      {
        heading: "9. Third-party services",
        paragraphs: [
          "The Services may interact with third-party blockchains, RPC endpoints, account-abstraction bundlers, email providers, fiat on/off-ramp partners, and integration platforms. Those services are governed by their own terms and privacy policies. We do not control and are not responsible for third-party services.",
        ],
      },
      {
        heading: "10. Intellectual property",
        paragraphs: [
          "Trustless Commerce names, logos, UI, and documentation are protected by applicable intellectual-property laws. These Terms do not grant you ownership of our software or brand. Open-source components may be available under separate licenses as indicated in our repository.",
        ],
      },
      {
        heading: "11. Privacy",
        paragraphs: [
          "Our Privacy Policy explains how we handle information. By using the Services, you acknowledge that policy.",
        ],
      },
      {
        heading: "12. Disclaimer of warranties",
        paragraphs: [
          "THE SERVICES ARE PROVIDED \"AS IS\" AND \"AS AVAILABLE\" WITHOUT WARRANTIES OF ANY KIND, WHETHER EXPRESS, IMPLIED, OR STATUTORY, INCLUDING IMPLIED WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, TITLE, AND NON-INFRINGEMENT. WE DO NOT WARRANT THAT THE SERVICES WILL BE UNINTERRUPTED, ERROR-FREE, OR SECURE.",
        ],
      },
      {
        heading: "13. Limitation of liability",
        paragraphs: [
          "TO THE MAXIMUM EXTENT PERMITTED BY LAW, WE WILL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, OR ANY LOSS OF PROFITS, DATA, OR GOODWILL, ARISING FROM YOUR USE OF THE SERVICES.",
          "OUR TOTAL LIABILITY FOR ANY CLAIM ARISING OUT OF OR RELATING TO THE SERVICES IS LIMITED TO THE GREATER OF (A) THE FEES YOU PAID US FOR THE SERVICES IN THE TWELVE (12) MONTHS BEFORE THE CLAIM, OR (B) ONE HUNDRED U.S. DOLLARS (USD $100).",
        ],
      },
      {
        heading: "14. Indemnity",
        paragraphs: [
          "You will defend, indemnify, and hold us harmless from claims arising out of your misuse of the Services, violation of these Terms, or violation of applicable law.",
        ],
      },
      {
        heading: "15. Changes",
        paragraphs: [
          "We may update these Terms from time to time. We will post the revised Terms with an updated date. Material changes may also be communicated through the Services where practicable. Continued use after changes become effective constitutes acceptance.",
        ],
      },
      {
        heading: "16. Termination",
        paragraphs: [
          "You may stop using the Services at any time. We may suspend or terminate access if you violate these Terms or if required for security or legal reasons. Termination does not affect on-chain assets you control outside our custody.",
        ],
      },
      {
        heading: "17. Governing law and venue",
        paragraphs: [
          "These Terms are governed by the laws of the State of Wyoming, United States, without regard to conflict-of-law principles. You agree that state and federal courts located in Wyoming have exclusive jurisdiction over disputes arising from these Terms or the Services, except where prohibited by law.",
        ],
      },
      {
        heading: "18. Contact",
        paragraphs: [
          "Questions about these Terms may be sent through our Telegram support channel at https://t.me/trustlesscommerce_support.",
        ],
      },
    ],
  },

  privacy: {
    id: "privacy",
    title: "Privacy Policy",
    lede: "What Trustless Commerce collects, what stays on your device, and what we never see.",
    lastUpdated: LEGAL_LAST_UPDATED,
    sections: [
      {
        heading: "1. Overview",
        paragraphs: [
          "Trustless Commerce is built around non-custodial wallets. We minimize the data we collect and never receive your passkey private keys, biometrics, seed phrases, or security-key PINs.",
        ],
      },
      {
        heading: "2. Information we do not collect",
        paragraphs: ["We do not collect or store:"],
        bullets: [
          "Passkey or security-key private keys.",
          "Biometric templates (fingerprints, face data, or voiceprints).",
          "Seed phrases or recovery phrases (we do not use them).",
          "YubiKey or security-key PINs.",
        ],
      },
      {
        heading: "3. Information we collect to operate the Services",
        paragraphs: ["When you use a Trustless Commerce wallet or merchant tools, we may process:"],
        bullets: [
          "Wallet address and on-chain public data.",
          "Passkey public key coordinates and WebAuthn credential identifiers.",
          "Device labels you choose when creating or pairing a device.",
          "Optional recovery email addresses and guardian contact information you provide.",
          "Super Wallet entity names, work emails, and key-enrollment metadata.",
          "Invoice and payment metadata you or your integrations submit (amounts, references, status).",
          "Technical logs such as IP address, user agent, and API request metadata for security and abuse prevention.",
        ],
      },
      {
        heading: "4. Information stored only on your device",
        paragraphs: [
          "Your browser may store locale, theme, wallet session, wallet registry entries, dismissed notices, invoice-create preferences, and similar settings in localStorage. This data stays on your device unless you clear site data.",
        ],
      },
      {
        heading: "5. How we use information",
        paragraphs: ["We use collected information to:"],
        bullets: [
          "Register wallets and devices and relay signed transactions to bundlers.",
          "Provide invoicing, checkout, merchant dashboards, and Super Wallet coordination.",
          "Send transactional email (for example recovery or notification messages).",
          "Operate fiat on/off-ramp flows when you choose to use them.",
          "Maintain security, prevent abuse, and comply with legal obligations.",
        ],
      },
      {
        heading: "6. Service providers",
        paragraphs: [
          "We use infrastructure and service providers such as RPC endpoints, account-abstraction bundlers, email delivery (noreply@trustless-commerce.com), hosting providers, and fiat partners. They process data only as needed to provide their portion of the Services.",
        ],
      },
      {
        heading: "7. We do not sell your personal information",
        paragraphs: [
          "We do not sell or share personal information for cross-context behavioral advertising. We do not operate an advertising network or analytics ad stack on the wallet product.",
        ],
      },
      {
        heading: "8. Retention",
        paragraphs: [
          "We retain information for as long as needed to operate the Services, comply with law, resolve disputes, and enforce agreements. You may request deletion of account metadata we control; we cannot delete or restore on-chain data or reconstruct a lost wallet.",
        ],
      },
      {
        heading: "9. Your rights",
        paragraphs: [
          "Depending on where you live, you may have rights to access, correct, delete, or export personal information we hold about you. Contact us through Telegram support to submit a request. We may need to verify your identity before responding.",
          "Residents of certain U.S. states may have additional privacy rights under state law. We will honor applicable requests as required.",
        ],
      },
      {
        heading: "10. Children",
        paragraphs: [
          "The Services are not directed to anyone under 18. We do not knowingly collect personal information from children.",
        ],
      },
      {
        heading: "11. International users",
        paragraphs: [
          "If you access the Services from outside the United States, you understand that information may be processed in the United States and other countries where our providers operate.",
        ],
      },
      {
        heading: "12. Changes",
        paragraphs: [
          "We may update this Privacy Policy from time to time. The \"Last updated\" date at the top will change when we do.",
        ],
      },
      {
        heading: "13. Contact",
        paragraphs: [
          "Privacy questions may be sent through our Telegram support channel at https://t.me/trustlesscommerce_support.",
        ],
      },
    ],
  },

  cookies: {
    id: "cookies",
    title: "Cookie Notice",
    lede: "How Trustless Commerce uses browser storage on your device.",
    lastUpdated: LEGAL_LAST_UPDATED,
    sections: [
      {
        heading: "1. Summary",
        paragraphs: [
          "Trustless Commerce does not use advertising cookies or third-party analytics trackers on the core wallet and commerce UI today. We rely on essential browser storage so the app can remember your preferences and wallet session.",
        ],
      },
      {
        heading: "2. What we store locally",
        paragraphs: ["Your browser may store the following in localStorage or similar on-device storage:"],
        bullets: [
          "tc-locale — your selected language.",
          "tc-theme — light or dark theme preference.",
          "tc-wallet-registry and tc-wallet-active — wallets registered on this browser.",
          "tc-wallet-session — active wallet session metadata.",
          "tc-create-prefs — remembered invoice-create form preferences.",
          "tc-notice-dismiss — dismissed in-app notices.",
          "tc.adminKey — admin API key if you use the /admin page on this browser.",
          "tc-walletMode — simple or advanced wallet UI mode.",
        ],
      },
      {
        heading: "3. Why this storage is used",
        paragraphs: [
          "This storage is strictly functional: it lets you stay signed in to a wallet on this device, keep your language and theme, and avoid re-entering merchant preferences. Without it, you would need to reconfigure the app on every visit.",
        ],
      },
      {
        heading: "4. Third-party embeds",
        paragraphs: [
          "If you follow links to external sites (documentation, GitHub, Telegram, blockchain explorers, or fiat partners), those sites may set their own cookies under their policies.",
        ],
      },
      {
        heading: "5. Managing storage",
        paragraphs: [
          "You can clear site data through your browser settings. Clearing storage will remove wallet session and registry entries on that browser; you can pair the wallet again if you still have another authorized device or recovery configured.",
        ],
      },
      {
        heading: "6. Changes",
        paragraphs: [
          "If we add analytics or non-essential cookies in the future, we will update this notice and, where required, request consent before use.",
        ],
      },
      {
        heading: "7. Contact",
        paragraphs: [
          "Questions about this notice may be sent through our Telegram support channel at https://t.me/trustlesscommerce_support.",
        ],
      },
    ],
  },

  risks: {
    id: "risks",
    title: "Risk Disclosures",
    lede: "Important risks when using non-custodial crypto wallets and on-chain payments.",
    lastUpdated: LEGAL_LAST_UPDATED,
    sections: [
      {
        heading: "1. Digital asset volatility",
        paragraphs: [
          "Stablecoins and other digital assets can lose value, de-peg, or become illiquid. Past performance does not predict future results.",
        ],
      },
      {
        heading: "2. Irreversible transactions",
        paragraphs: [
          "On-chain payments generally cannot be reversed once confirmed. Sending to the wrong address or wrong network may result in permanent loss.",
        ],
      },
      {
        heading: "3. Smart-contract and protocol risk",
        paragraphs: [
          "Wallets, forwarders, and settlement contracts may contain bugs or be upgraded. Third-party chains, RPC providers, and bundlers may fail or behave unexpectedly.",
        ],
      },
      {
        heading: "4. Self-custody risk",
        paragraphs: [
          "You alone control authorization to move funds. If you lose every device, delete passkeys, or fail to configure recovery, funds may become inaccessible. Trustless Commerce cannot reset your biometrics or recover your private keys.",
        ],
      },
      {
        heading: "5. Phishing and social engineering",
        paragraphs: [
          "Attackers may impersonate support, invoices, or websites. We will never ask for a seed phrase. Always verify the website origin and transaction details in your passkey prompt before approving.",
        ],
      },
      {
        heading: "6. Regulatory uncertainty",
        paragraphs: [
          "Laws governing digital assets vary by jurisdiction and may change. You are responsible for determining whether your use of the Services is lawful where you live or operate.",
        ],
      },
      {
        heading: "7. Third-party rails",
        paragraphs: [
          "Fiat on/off-ramps, email delivery, blockchains, and integration platforms are operated by third parties. Their outages or policy changes can affect your experience.",
        ],
      },
      {
        heading: "8. Testnet vs mainnet",
        paragraphs: [
          "Testnet assets have no real-world value. Before using mainnet, confirm you are on the intended network and understand real funds are at risk.",
        ],
      },
      {
        heading: "9. Super Wallet",
        paragraphs: [
          "Upgrading to Super Wallet is irreversible. Email recovery is permanently disabled after upgrade. Team multisig adds operational complexity; loss of quorum keys can lock funds.",
        ],
      },
      {
        heading: "10. No investment advice",
        paragraphs: [
          "Nothing in the Services constitutes investment, tax, or legal advice. Consult qualified professionals before making financial decisions.",
        ],
      },
    ],
  },

  "security-checks": {
    id: "security-checks",
    title: "Security checks",
    lede: "How Trustless Commerce handles wallets and what you should verify before creating or using one.",
    lastUpdated: LEGAL_LAST_UPDATED,
    sections: [
      {
        heading: "1. Non-custodial by design",
        paragraphs: [
          "Trustless Commerce is wallet software, not a bank account. Your USDC, USDT, and other supported assets live on public blockchains at your wallet address. We cannot see your balance in a custodial ledger, freeze your funds, or send them on your behalf.",
          "Control of the wallet belongs to the passkeys and security keys you authorize. Only someone who can unlock those keys on an enrolled device can sign transactions.",
        ],
      },
      {
        heading: "2. What we cannot do for you",
        paragraphs: ["Because we are non-custodial, we cannot:"],
        bullets: [
          "Reset your biometrics or device PIN.",
          "Recover a wallet if every authorized device is lost and recovery was not set up.",
          "Reverse a confirmed on-chain transaction.",
          "Move funds out of your wallet without your signature.",
        ],
      },
      {
        heading: "3. Protect your funds — use multiple devices",
        paragraphs: [
          "If this browser or phone is your only authorized device, losing or replacing it without pairing another device first can mean permanent loss of access.",
          "Before you rely on a wallet for business funds, pair at least one additional trusted device from Wallet → Security → Devices. Passkey sync through iCloud or Google Password Manager alone is not sufficient; you must complete the in-app pairing flow so the wallet recognizes the new device.",
        ],
      },
      {
        heading: "4. WebAuthn and secure hardware",
        paragraphs: [
          "When you create a wallet, your browser creates a passkey in a platform authenticator — typically the secure hardware built into your phone or computer (Secure Enclave, TPM, or equivalent).",
          "The private signing key never leaves that hardware. When you approve a transaction, the authenticator requires user verification: your fingerprint, face, or device PIN. Trustless Commerce receives only the cryptographic signature and public key coordinates needed to verify the action; we never receive biometric data or the private key.",
        ],
      },
      {
        heading: "5. Optional backup and recovery",
        paragraphs: [
          "You may add a YubiKey or compatible security key as an additional signing method. You may also configure email recovery with a guardian approval delay for simple wallets.",
          "Super Wallet upgrades disable email recovery permanently. Plan recovery and device access before upgrading.",
        ],
      },
      {
        heading: "6. Avoid phishing",
        paragraphs: [
          "Use only the official Trustless Commerce origin you navigated to yourself. Do not enter wallet credentials on sites linked from unsolicited messages. We will never ask for a seed phrase — our wallets do not use seed phrases.",
          "Read the passkey prompt carefully: verify the domain, transaction type, and recipient before approving.",
        ],
      },
      {
        heading: "7. Before you create a wallet",
        paragraphs: ["Confirm that you:"],
        bullets: [
          "Understand funds are on-chain and under your control, not ours.",
          "Have a plan to pair another device or configure recovery.",
          "Are on the genuine website and not an impersonation.",
          "Accept that lost devices without backup can mean lost access.",
        ],
      },
      {
        heading: "8. Contact",
        paragraphs: [
          "Report suspected phishing or security issues through our Telegram support channel at https://t.me/trustlesscommerce_support.",
        ],
      },
    ],
  },
};

export const LEGAL_DOC_ORDER: LegalDocId[] = ["terms", "privacy", "cookies", "risks", "security-checks"];

export function legalDocPath(id: LegalDocId): string {
  return id === "terms" ? "/terms" : `/${id}`;
}
