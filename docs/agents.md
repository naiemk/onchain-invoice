# Agents

Use the Cursor skill in this repo:

`.cursor/skills/trustless-commerce-invoice/SKILL.md`

Also linked from [`AGENTS.md`](https://github.com/naiemk/onchain-invoice/blob/main/AGENTS.md).

Flow:

1. Collect price, `to`, chain, USDC, `clientInvoiceId`
2. `POST /api/invoices`
3. Return pay URL + status URL
4. Poll `GET /api/invoices/{id}`
