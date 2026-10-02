# Identity wallet audit, iteration 3

Third pass on the same contracts as [iteration 1](wallet-identity-audit.md) and [iteration 2](wallet-identity-audit-iteration-2.md) (`3be1976e8b2090649fa643dd54ceacae18e32245`, solc 0.8.26, OpenZeppelin 5.6.1). This pass assumes every fix in iteration 2 is already implemented, then asks what that implementation breaks and what it left unspecified. The contracts in the repo are still the unfixed ones. Nothing here is a patch.

Iteration 2 closed AUD-01 through AUD-10 inside the product's design. Four holes sit in those fixes as they were written. Two of them are on paths a lost-device user depends on. None of them belong on invoice creation or on an ordinary spend.

| Severity | Count | Ids |
|----------|------:|-----|
| High | 2 | AUD-11, AUD-13 |
| Medium | 2 | AUD-12, AUD-14 |

## What stays cheap

Security still wins on theft and lockout. The paths that run all day stay on their current cost. The new writes sit on enrollment, device changes, and recovery.

| Path | How often | What it costs after these fixes | Where the new work is forbidden |
|------|-----------|----------------------------------|---------------------------------|
| `POST /api/invoices` | Hottest product call | SQLite insert plus a local CREATE2 prediction | No identity-store read, no WebAuthn, no nullifier, no RPC added to make it "consistent" with register |
| Invoice sweep | Once per invoice, when funds arrive, paid by the sweeper | Existing lazy clone plus token pulls | No identity check inside `sweep` or `bulkSweep` |
| Simple-wallet spend | Every send | One view call: `IdentityStore.verify` of one WebAuthn or P-256 signature. EntryPoint v0.9 already burns the UserOp nonce | No `SSTORE`, no `usedAuth` read, no second signature check, no change to `DEFAULT_GAS` |
| Operator restore | Rare, 2-of-3 | Two or three P-256 checks, then the store writes below | That cost stays on the recovery UserOp |
| Register, add, remove, cancel, disable, clone deploy, operator schedule | Rare | One signature check where a signature is required, and one new storage write where a replay must die | Not on the two rows above |

`createInvoice` in [`commerce/server/routes.ts`](../commerce/server/routes.ts) assigns `invoiceSeed`, derives `invoiceId`, and calls `getInvoiceAddress`. For an EVM chain that has `forwarderImplementation` set, that address is `predictCommerceInvoiceAddress` on the server. The invoice salt is `keccak256(abi.encodePacked(to, invoiceId))` in [`CommerceInvoiceSweeper`](../contracts/commerce/CommerceInvoiceSweeper.sol). It is a different salt from the wallet salt. Wallet fixes do not move invoice registration onto `IdentityStore`.

A simple spend goes through `Account.validateUserOp` into `IdentityWallet._rawSignatureValidation`, which calls `store.verify` and compares the result to `identityId`. That function is `view`. On Base the RIP-7212 precompile at `0x100` verifies P-256; OpenZeppelin falls back to a large Solidity verifier only when the precompile is absent. One check fits in the existing `verificationGasLimit` of 500_000 (`DEFAULT_GAS` in [`commerce/shared/userop.ts`](../commerce/shared/userop.ts)). A storage write inside `verify` would land on `IdentityStore`, which is a different contract from the account, so a bundler rejects it during validation and the payment never lands. The EntryPoint nonce already makes the UserOp single-use, so a nullifier on this path adds a write and does not add a security property.

Operator UserOps may pass a higher verification gas for two or three P-256 checks. The default for ordinary sends stays where it is.

The rare-path write is one slot, about 22,000 gas when the slot was zero. That is the right place to pay:

- `usedAuth[identityId][authId]` on add and on remove
- `restoreNonce` packed into the pending restore record that initiate and replace already rewrite
- `restoreEnabled` on disable, which the store already updates
- the scheduled-operator record, written only when the owner schedules

Cancel does not need its own nullifier slot. The pending record and `restoreNonce` already make the signature single-use. Disable does not need an `authId`. It can succeed once; `restoreEnabled` is the marker. Register does not need an `authId`. `IdentityExists` is the marker. Verifying the WebAuthn assertion at register is one P-256 per identity, at signup.

On-chain X.509 attestation stays out. It is large, format-specific, and the iteration 2 choice (a `webauthn.get` over `identityId`, checked with `IdentitySigLib.verifyWebAuthn`) is the check that matches the design.

## Assumed in place

Treating iteration 2 as shipped:

- `createAccount(identityId, index)` derives the V1 salt. Existing code is returned when `identityId()` matches and rejected otherwise. The worker reads `identityId()` before it marks a wallet deployed.
- `register` checks a WebAuthn assertion over `identityId` against `(qx, qy)`. The API treats a qx/qy mismatch as an error. The chain receipt is what earns the database row.
- `AddMethod` and `RemoveMethod` carry `bytes32 authId` inside the EIP-712 struct.
- Cancel signs `CancelRestore(identityId, restoreNonce, qx, qy, eoa, executeAfter)`. `restoreNonce` increments on initiate.
- Initiate rejects a method id that already exists and rejects `methodCount == 32`.
- `disableRestore` requires `methodCount >= 2`. While restore is off, `removeMethod` leaves at least two methods. `addMethod` still works after disable. There is no re-enable.
- The constructor sets `restoreDelay` to 259200. No setter lowers it. `restoreAddMethod` does not execute in the same transaction. `setRecoveryOperator` is schedule-then-execute with a 259200 delay. The deploy script does not default the operator to the deployer.
- `disableRestore` also accepts an IDS1 blob from any current method. The direct EOA call remains, with the same count check.

The design rules from iteration 2 still bind: email off chain, simple wallet stays 1-of-n, lost-device recovery stays operator 2-of-3 then delay then permissionless `executeRestore`, salt preimage string stays `TC-IDENTITY-WALLET-V1`, the new recovery key stays inside the signed operator calldata, the deployer is a relayer.

## AUD-11 — `replaceRestore` can postpone a valid restore forever

- **Severity:** High
- **Property:** Lockout
- **Opened by:** the AUD-04 fix

Iteration 2 adds `replaceRestore`. As specified, it overwrites any pending slot and sets `executeAfter = block.timestamp + restoreDelay`. Today `initiateRestore` reverts with `RestorePending` while a slot is active, so the operator cannot move a clock that has already started. After the fix they can.

A lost-device user cannot cancel. Each replace starts another three days, and `executeRestore` never becomes reachable. The operator does not have to install a key to cause that. A second support retry, or a worker that refreshes the pending key because the first transaction looked stuck, does it with no theft in mind.

This is a smaller stick than waiting out one delay and installing an operator key. It is a different failure. Theft-after-one-delay is the accepted operator assumption. A clock that never finishes means the recovery the user was promised does not complete. A typo that is a fresh valid point is handled by letting that one delay finish: the useless method is added, the slot clears, and a new initiate starts one more delay. Six days for a typo is the trade. An open-ended reset is the bug.

**Fix.** `replaceRestore` succeeds only when the current pending restore cannot be executed, and the replacement can:

- the pending record is active
- `computeMethodId` of the pending key already exists, or `methodCount == 32`
- `computeMethodId` of the new key does not exist
- `methodCount < 32`, so the new key can be added when the delay ends

A pending key that is not yet on the identity, with room left under 32, cannot be replaced. `executeAfter` from the original initiate stands. A stuck slot (the key was added by a remaining device during the delay, or the list filled up after initiate) can be replaced onto one fresh key. That write sets a new `executeAfter` and increments `restoreNonce`. The new record is executable, so a second replace reverts. One repair, one delay.

The new `(kind, qx, qy, eoa)` stays inside the operator UserOp calldata, the same binding iteration 2 tested for `initiateRestore`. A replace that reads the key from an unsigned argument or from a side queue drops that binding.

`kind` belongs in the cancel struct next to `qx`, `qy`, `eoa`, and `executeAfter`, so the signature covers the whole pending tuple. Cancel remains a rare path. It still does not write `usedAuth`.

A full list of 32 methods and zero remaining keys stays unrestorable: replace cannot free a slot, and the operator cannot remove a method. That case is outside normal use. The way to handle it later is a dedicated restore that drops one method and adds the new key, on this rare path, with its own delay. It is not a reason to let replace reset a healthy clock, and it is not something `verify` should do.

## AUD-12 — a global `usedAuth` map lets one identity burn another's signature

- **Severity:** Medium
- **Property:** Griefing
- **Opened by:** the AUD-02 fix

Iteration 2 stores `usedAuth[authId]`. The id is inside the typed struct, so a watcher cannot swap it on the victim's signature. They can copy it.

Add and remove are public. An attacker with any identity of their own signs `AddMethod` for their identity using the `authId` from the victim's mempool transaction (or from a low counter such as 1, 2, 3). Their transaction lands first, the global slot flips, and the victim's in-flight signature reverts. The victim picks a new id and retries. A client that derives `authId` as `hash(newKey)` and then refuses to change it cannot retry, and it also cannot re-enroll that key after a legitimate remove, because the first signature burned the only id that client will ever produce.

**Fix.** Key the slot by identity:

```text
usedAuth[identityId][authId]
```

Still one `SSTORE`, still only inside `addMethod` and `removeMethod`, after the signature check and before the method list changes. `authId == 0` reverts, so an omitted field does not become a shared nullifier. The client draws a fresh 32-byte id for every signature. A new signature from a current method can add a key again. The published old signature cannot.

The check stays out of `verify` and out of `validateUserOp`. Those run on every send and must remain a view.

## AUD-13 — the public signup assertion can authorize `disableRestore`

- **Severity:** High
- **Property:** Lockout
- **Opened by:** the AUD-10 fix

Iteration 2 says `disableRestore` should accept an IDS1 blob from any current method. It does not name the digest. Every other blob enters through `verify(message, blob)`. The signup assertion is a public blob whose WebAuthn challenge is `identityId`: it has to be, because that is how AUD-07 binds the key. Once the method is stored, `verify(identityId, registrationBlob)` returns that identity. The assertion sits in the register transaction forever.

A disable implemented as `verify(identityId, blob)` therefore succeeds for anyone, as soon as `methodCount >= 2`. The caller turns email recovery off. The user still has their methods, so they are not locked out that day. Losing the last methods later is permanent, and the operator can no longer start a restore. The user never signed a disable.

Reusing `CancelRestore(...)` is the other collision. A cancel signature would disable restore, or a disable signature would cancel a restore, depending on which function hashed which type.

The direct EOA path already clears a pending restore when it disables (the `delete pendingRestores` in `disableRestore` today). A second function that only flips `restoreEnabled` leaves a pending record in place. `executeRestore` still reverts while restore is off, because that check happens before `_addMethod`. The pending key is not installed. Clearing the slot is what makes "restore is off" a single state, and it keeps a later change from executing a stale key whose `executeAfter` has already passed.

**Fix.** One typehash, used nowhere else:

```text
DisableRestore(bytes32 identityId)
```

The blob path is `verify(hashDisableRestore(identityId), authorization) == identityId`, then the same body as the EOA path: `methodCount >= 2`, reject when already disabled, delete the pending restore if one is active, set `restoreEnabled` false. The EOA `msg.sender` path stays, with the same count check, so an Etherscan user still pays gas without a bundler. No `authId` and no extra `SSTORE`.

Register keeps using `IdentitySigLib.verifyWebAuthn` on `identityId` before the method exists. No later function passes raw `identityId` as the `verify` message. Spend messages stay UserOp hashes. Add, remove, cancel, and disable each keep their own typehash.

## AUD-14 — rescheduling the operator can keep the old deadline

- **Severity:** Medium
- **Property:** Theft
- **Opened by:** the AUD-06 fix

Iteration 2 turns `setRecoveryOperator` into schedule-then-execute with an immutable 259200 delay. It does not say what a second schedule does to a deadline that is already running.

The owner key schedules a rotation to the new operator wallet. The three-day clock starts. An attacker who later holds that owner key schedules their own address and leaves `executeAfter` where it was. When the original deadline arrives, anyone may execute, and `recoveryOperator` becomes the attacker's wallet. From there the accepted restore path applies: initiate, wait `restoreDelay`, install a key. The rotation the owner thought would take three days completes on whatever time was left, down to the next block.

A first schedule, with the clock set inside that transaction, still takes the full three days. This hole is the overwrite.

**Fix.** Every schedule stores `next` and sets `executeAfter = block.timestamp + 259200`, including when a schedule is already pending. `next` cannot be `address(0)` and cannot be the current operator. Execute waits until that deadline, then writes `recoveryOperator` and clears the schedule. Anyone may execute once the time has passed, so a lost owner key does not freeze a rotation that already matured. The owner may cancel by deleting the schedule. A cancel does not change `recoveryOperator` and does not shorten a future schedule.

The event is `RecoveryOperatorScheduled(next, executeAfter)`. Wallets and the operator worker keep calling the current on-chain `recoveryOperator` until `RecoveryOperatorUpdated`. A worker that aims at `next` early sends restores that the store rejects; the on-chain check is what keeps a single key from starting a restore during the wait.

The contract does not try to prove that `next` is a 2-of-3 identity wallet. That check is brittle and it belongs off chain. A compromised owner can still aim the schedule at an EOA they hold. Users move funds during the three days. The delay floor still means the owner cannot turn restore into a same-transaction add.

## What this pass leaves standing

These stay true after the four corrections above. They are not new findings.

- A stolen method can still spend, add the attacker's key, and remove the user's key down to the floor. While restore is on, the floor is one method. While restore is off, the floor is two. The stolen method can add its own second key and then delete the user's methods down to those two. That is 1-of-n. The floor stops a single key from stranding the identity with restore already off. It does not stop a live stolen method from rotating the set. `addMethod` after disable stays allowed, because a live method has to be able to enroll a replacement device.
- Order while restore is on: the stolen method can remove the user down to one key, and then `disableRestore` reverts because `methodCount < 2`. The operator can still start a restore. The stolen method can also cancel that restore. Both follow from 1-of-n.
- Operator theft after one real three-day wait stays the trusted assumption. AUD-11 removes the ability to stretch that wait. It does not remove the ability to finish it.
- A copied registration assertion registers the user's key. It does not install a different key. It must not be accepted as add, remove, cancel, or disable, which is what distinct typehashes are for.
- `createAccount(victim, 99)` deploys a wallet the victim controls. The API allocates `index` from its own counter and keeps showing that address. Extra clones are not adopted as the receive address.
- The factory's `identityId()` check is one storage read on deploy, and only when code is already there. Invoice prediction does not do it.
- One operator identity still cannot start a restore. Two can. A remaining user method can cancel during the delay. After the delay the installed key can spend.
- A signature over one restore key does not authorize a swapped key, as long as replace and initiate keep the key in the signed calldata.
- EntryPoint v0.9, ERC-7821, checked `uint8` math, and OpenZeppelin's WebAuthn challenge and UV checks are unchanged. `rpId` is still not pinned. Pinning it would be extra hashing on every spend for a check the authenticator already binds. Legacy `AdminGuardianRecovery` still cannot drive an identity clone.
- The sweeper owner can still change `feeRecipient`, `feeBps`, and `minFee` with no timelock. That is the invoice system. It stays out of the identity-store change. Sweep gas stays one clone when the invoice is not deployed yet, then the token pulls.

No new critical issue shows up in P-256 verification, the Super Wallet bitset, or `initialize`, once AUD-11 is narrowed. The critical item from iteration 1 remains AUD-01 until that fix is actually deployed. This pass only describes the holes that open when the iteration 2 fixes are built as written.
