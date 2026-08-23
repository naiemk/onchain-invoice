# Agents

Use the Cursor skill in this repo:

`.cursor/skills/trustless-commerce-invoice/SKILL.md`

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

Also linked from [`AGENTS.md`](https://github.com/naiemk/onchain-invoice/blob/main/AGENTS.md).

Flow:

1. Collect price, `to`, chain, USDC, `clientInvoiceId`
2. `POST /api/invoices`
3. Return pay URL + status URL
4. Poll `GET /api/invoices/{id}`
