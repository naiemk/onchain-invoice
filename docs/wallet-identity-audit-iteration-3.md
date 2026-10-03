# Identity wallet audit, iteration 3

Third pass on the same contracts as [iteration 1](wallet-identity-audit.md) and [iteration 2](wallet-identity-audit-iteration-2.md) (`3be1976e8b2090649fa643dd54ceacae18e32245`, solc 0.8.26, OpenZeppelin 5.6.1). This pass assumes every fix in iteration 2 is already implemented, then asks what that implementation breaks and what it left unspecified. The contracts in the repo are still the unfixed ones. Nothing here is a patch.

Iteration 2 closed AUD-01 through AUD-10 inside the product's design. A second look at those fixes produced four notes. Re-checked against one rule: a contract change has to enforce an authorization or state invariant that a caller can break on their own. Procedures for the operator, the worker, and the wallet UI stay off chain.

| Id | In the contract? | Why |
|----|------------------|-----|
| AUD-11 | No new function | A malicious operator can already wait out one delay and install a key. A support retry that resets the clock is a worker bug. `replaceRestore`, and the rules for when it may run, would encode that procedure. Leave the function out. |
| AUD-12 | Yes | `usedAuth[authId]` lets a stranger consume another identity's signature. The signature's scope is `identityId`. The storage key has to match. Same one write. |
| AUD-13 | Yes | Disable is permissionless once the user has signed. The signup assertion is already public. A relayer policy cannot stop a caller from replaying it. The typehash is the authorization check. |
| AUD-14 | Yes, one assignment | The timelock's promise is that a new operator waits 259200 seconds. A second schedule that keeps the old deadline breaks that promise for the holder of the owner key, which is the key the timelock exists for. Checking that the new operator is a 2-of-3 wallet stays off chain. |

Contract work from this pass is AUD-12, AUD-13, the deadline reset in AUD-14, and one branch in `executeRestore` for a pending key that is already on the identity. `replaceRestore` is not a contract change.

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
- `restoreNonce` packed into the pending restore record that initiate already rewrites
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

## AUD-11 — withdrawn. Do not add `replaceRestore`

- **Severity:** none as a contract finding
- **Opened by:** the AUD-04 fix, as first written

Iteration 2 adds `replaceRestore`, which overwrites any pending slot and starts a new delay. That function is what would let a caller keep moving `executeAfter`. The scenarios that motivated restricting it are a worker retrying a healthy restore, and a 2-of-3 operator choosing to stall. The first is a bug in the worker. The second is inside the trust already given to that operator: after one delay they can install a key of their own. Solidity that distinguishes a "good" replace from a "bad" one is an operations policy.

The contract side of AUD-04 is the check already specified: `initiateRestore` reverts when that method id exists or `methodCount == 32`. While a slot is active, `RestorePending` continues to reject a second initiate. There is no second function.

One state-machine line belongs with that fix, because it is not a procedure. `executeRestore` today deletes the slot and then calls `_addMethod`. If the pending key was added during the delay, `_addMethod` reverts `MethodExists` and the delete reverts with it. The slot stays full. A user who still holds any method, including that key, can `cancelRestore`. The wedge matters when no method remains: nobody can cancel, and nobody can start a different key. Closing the slot when `computeMethodId` of the pending key already exists is the success case (the key is on the identity). `executeRestore` deletes the pending record and returns. Anyone may call it, same as today. No new arguments. A list that is already at 32 methods, with no key left to remove one, stays a residual. It does not justify a replace API.

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

Still one `SSTORE`, still only inside `addMethod` and `removeMethod`, after the signature check and before the method list changes. A published signature for that identity cannot be reused. Another identity's transaction cannot flip the slot.

How the wallet picks the id is a client concern. The contract does not inspect entropy, reject low counters, or expire ids. Those checks would be a policy layer on top of a mapping that is already doing the job. The id stays inside the EIP-712 struct so a watcher cannot swap it.

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

**Fix.** Every schedule stores `next` and sets `executeAfter = block.timestamp + 259200` in that same write, including when a schedule is already pending. Execute waits until the stored deadline, then writes `recoveryOperator` and clears the schedule. Anyone may execute once the time has passed. `next == address(0)` reverts, the same class of check as the other address arguments on this contract.

That is the whole contract change. It does not include a proof that `next` is a 2-of-3 identity wallet, a watcher, or a rule about which address the worker should call. `initiateRestore` already requires `msg.sender == recoveryOperator`, so a worker that aims at the scheduled address early is rejected by the existing check. A compromised owner can still schedule an EOA they hold. Moving funds during the three days is the owner's response, and it stays off chain. The delay floor still means the owner cannot turn restore into a same-transaction add.

## What this pass leaves standing

These stay true after the four corrections above. They are not new findings.

- A stolen method can still spend, add the attacker's key, and remove the user's key down to the floor. While restore is on, the floor is one method. While restore is off, the floor is two. The stolen method can add its own second key and then delete the user's methods down to those two. That is 1-of-n. The floor stops a single key from stranding the identity with restore already off. It does not stop a live stolen method from rotating the set. `addMethod` after disable stays allowed, because a live method has to be able to enroll a replacement device.
- Order while restore is on: the stolen method can remove the user down to one key, and then `disableRestore` reverts because `methodCount < 2`. The operator can still start a restore. The stolen method can also cancel that restore. Both follow from 1-of-n.
- Operator theft after one real three-day wait stays the trusted assumption. The contract does not grow a function whose job is to stop that operator from scheduling a second restore.
- A copied registration assertion registers the user's key. It does not install a different key. It must not be accepted as add, remove, cancel, or disable, which is what distinct typehashes are for.
- `createAccount(victim, 99)` deploys a wallet the victim controls. The API allocates `index` from its own counter and keeps showing that address. Extra clones are not adopted as the receive address.
- The factory's `identityId()` check is one storage read on deploy, and only when code is already there. Invoice prediction does not do it.
- One operator identity still cannot start a restore. Two can. A remaining user method can cancel during the delay. After the delay the installed key can spend.
- A signature over one restore key does not authorize a swapped key. `initiateRestore` keeps `(kind, qx, qy, eoa)` in the signed operator calldata.
- EntryPoint v0.9, ERC-7821, checked `uint8` math, and OpenZeppelin's WebAuthn challenge and UV checks are unchanged. `rpId` is still not pinned. Pinning it would be extra hashing on every spend for a check the authenticator already binds. Legacy `AdminGuardianRecovery` still cannot drive an identity clone.
- The sweeper owner can still change `feeRecipient`, `feeBps`, and `minFee` with no timelock. That is the invoice system. It stays out of the identity-store change. Sweep gas stays one clone when the invoice is not deployed yet, then the token pulls.

No new critical issue shows up in P-256 verification, the Super Wallet bitset, or `initialize`. The critical item from iteration 1 remains AUD-01 until that fix is actually deployed. Contract changes from this pass are the per-identity nullifier, the `DisableRestore` typehash, the operator-schedule deadline written on every schedule, and closing a pending restore whose key is already a method. `replaceRestore` is not one of them.
