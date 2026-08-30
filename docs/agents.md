# Agents

Use the Cursor skill in this repo:

`.cursor/skills/trustless-commerce-invoice/SKILL.md`

HMAC passkey wallet client API (partner domain WebAuthn):

`.cursor/skills/trustless-commerce-wallet/SKILL.md`

Platform integration skills (WooCommerce, Shopify, Kajabi, Teachable, and more):

| Platform | Skill |
|----------|-------|
| WooCommerce | `.cursor/skills/trustless-commerce-woocommerce/SKILL.md` |
| Shopify | `.cursor/skills/trustless-commerce-shopify/SKILL.md` |
| Kajabi | `.cursor/skills/trustless-commerce-kajabi/SKILL.md` |
| Teachable | `.cursor/skills/trustless-commerce-teachable/SKILL.md` |
| BigCommerce | `.cursor/skills/trustless-commerce-bigcommerce/SKILL.md` |
| Lemon Squeezy | `.cursor/skills/trustless-commerce-lemonsqueezy/SKILL.md` |
| Gumroad | `.cursor/skills/trustless-commerce-gumroad/SKILL.md` |
| Wallet client (HMAC) | `.cursor/skills/trustless-commerce-wallet/SKILL.md` |

Also linked from [`AGENTS.md`](https://github.com/naiemk/onchain-invoice/blob/main/AGENTS.md).

### Invoices

1. Collect price, `to`, chain, USDC, `clientInvoiceId`
2. `POST /api/invoices`
3. Return pay URL + status URL
4. Poll `GET /api/invoices/{id}`

### Embedded wallets

1. Admin-issue wallet client (`rpId` + HMAC secret)
2. Challenge → WebAuthn on **partner** domain → `POST /api/client/wallets`
3. List / send / recover per [Wallet client API](wallet-client-api.md)
