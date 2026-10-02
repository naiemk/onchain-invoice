# Identity wallet audit, iteration 2

Iteration 3 assumes the fixes below and attacks that result: [wallet-identity-audit-iteration-3.md](wallet-identity-audit-iteration-3.md).

Second pass on the same contracts as [iteration 1](wallet-identity-audit.md) (`3be1976e8b2090649fa643dd54ceacae18e32245`, solc 0.8.26, OpenZeppelin 5.6.1). Iteration 1 listed AUD-01 through AUD-07. This pass does three things: it keeps the fixes inside the product's design, it attacks those fixes, and it records what a second look found.

Contracts are still unchanged. New checks are in [`test/IdentityWalletAudit.ts`](../test/IdentityWalletAudit.ts). `npx hardhat test test/IdentityWalletAudit.ts` — 9 passing. The iteration 1 failures still fail on the current code. That is deliberate.

## Design this pass will not break

These are the rules the fixes have to obey. They come from [`docs/wallet-mainnet-assurance.md`](wallet-mainnet-assurance.md), [`docs/security.md`](security.md), and the comments on `IdentityStore.register`.

- Email stays off the chain. `identityId` stays a random id. The database is an index. The store is the authority for methods.
- A simple wallet is 1-of-n. Any current method can spend and can add or remove methods. This pass does not turn that into a threshold.
- Lost-device recovery is a 2-of-3 operator Super Wallet calling `initiateRestore`, then `restoreDelay`, then anyone calling `executeRestore`. A remaining method can `cancelRestore` during the delay. A user with no method cannot cancel. That trust stays.
- The production delay is 259200 seconds. It is a frozen constant, not a knob an owner should be able to lower.
- `disableRestore` is permanent. There is no re-enable. After it, the remaining methods are the only recovery. The launch rule is that this happens only once a second method exists (EOA or YubiKey), and that a later removal cannot strand the identity on one method.
- `addMethod` still works after `disableRestore`. Security.md says so, so a live method can still enroll a replacement device.
- The counterfactual address is `keccak256(abi.encode("TC-IDENTITY-WALLET-V1", identityId, index))`. Anyone may deploy that address. They may not choose a different identity for it. The preimage string stays. Mainnet has no identity factory yet, so the factory can start enforcing this without moving existing addresses.
- The new recovery key is chosen inside the operator UserOp. Two operator identities sign that calldata. A fix must not take the new key from an unsigned argument.
- The deployer key is a relayer. It is not the owner of the user's identity, and it is not `recoveryOperator`.
- User-facing Super Wallet stays out of this certification. Operator Super stays in.

Rejected because they fight those rules:

| Idea | Why it does not fit |
|------|---------------------|
| `identityId = hash(email)` or storing email on chain | Breaks the off-chain identity |
| One global nonce for add/remove | Two devices cannot both hold a valid signature at once |
| Only the operator may call `executeRestore` | A dead operator after the delay locks the user (assurance S12) |
| A new salt version string | Changes every counterfactual address |
| `recoveryOperator` = guardian EOA, for easier ops | Collapses 2-of-3 into one key |
| Making `disableRestore` reversible | The launch policy is that it is permanent |
| Blocking `addMethod` after `disableRestore` | Removes the way a live method enrolls a replacement |
| Trusting the WebAuthn attestation object the API stores today | `createPasskey` uses a random challenge ([`ui/src/shared/webauthn.ts`](../ui/src/shared/webauthn.ts)), and attestation `none` does not prove the key signed `identityId` |

## Fixes

Each fix names the smallest change that closes the finding and still matches the list above.

### AUD-01 — salt

`createAccount(identityId, index)` computes

```text
salt = keccak256(abi.encode("TC-IDENTITY-WALLET-V1", identityId, index))
```

and does not take a caller-supplied salt. If the clone already exists, return it only when `IdentityWallet(wallet).identityId() == identityId`. Otherwise revert.

Anyone can still deploy the user's wallet. That is the counterfactual design. They cannot deploy their own identity at that address. The worker must read `identityId()` before it marks a wallet deployed. Today, code at the address is treated as success ([`commerce/wallet-deployer/worker.ts`](../commerce/wallet-deployer/worker.ts)).

### AUD-07 — register

`register` verifies a WebAuthn **assertion** (`webauthn.get`) over `identityId` with `IdentitySigLib.verifyWebAuthn` against the supplied `(qx, qy)`, then stores the method. The browser creates the passkey, then asserts with the challenge set to `identityId`. The deployer only relays that assertion.

A front-runner who copies the assertion registers the user's key. A front-runner who substitutes another key fails verification.

The API change that goes with this is below (AUD-08). Checking the assertion only in the API leaves the mempool path open.

### AUD-02 — add and remove replay

Add `bytes32 authId` to the EIP-712 structs `AddMethod` and `RemoveMethod`. The store keeps `usedAuth[authId]` and reverts if it is set. The id is inside the signature, so a watcher cannot swap it. Two devices pick different ids and can both be in flight. Wallets keep showing the typed struct, including the new key.

Do not use a single incrementing nonce.

### AUD-03 — cancel replay

Store a `restoreNonce` on the pending record, incremented on every initiate. The cancel struct is `CancelRestore(identityId, restoreNonce, qx, qy, eoa, executeAfter)`. A blob from a previous restore does not verify for the next one. The signer is still any current method.

### AUD-04 — stuck slot

`_initiateRestore` reverts if that method id already exists or if `methodCount == 32`. The operator wallet may call `replaceRestore` with a new key. That function overwrites the slot and sets `executeAfter = block.timestamp + restoreDelay`. It does not shorten a running delay. The user can cancel the replacement with a signature over the new record. There is no owner function that clears the slot in one transaction.

### AUD-05 — one method and restore off

`disableRestore` reverts unless `methodCount >= 2`. `removeMethod` reverts when `restoreEnabled` is false and the removal would leave fewer than two methods. `LastMethod` still blocks a removal to zero while restore is on. No re-enable.

### AUD-06 — delay and owner

The constructor sets `restoreDelay` to 259200 and there is no setter that can lower it. `restoreAddMethod` no longer executes in the same transaction. `setRecoveryOperator` becomes schedule-then-execute with a delay of 259200, and that delay is immutable. The deploy script requires `IDENTITY_RECOVERY_OPERATOR` to be the operator wallet. It does not default to the deployer.

The owner can still replace a dead operator. They cannot do it today, and they cannot zero the three days.

### AUD-10 — YubiKey cannot turn restore off

This showed up while checking AUD-05 against the launch rule "second method is an EOA or a YubiKey".

`disableRestore` requires `msg.sender` to be an EOA method (`RestoreRequiresEoa`). A passkey plus a YubiKey is two methods, the YubiKey can spend, and restore stays on. The operator's power cannot be removed. Test: "a YubiKey second method cannot turn restore off".

Keep the direct EOA call so a user can pay gas on Etherscan. Also accept an IDS1 blob from any current method, with the same `methodCount >= 2` check. A YubiKey assertion can then turn restore off without a bundler-specific path beyond the signature the store already verifies.

## Attacks on these fixes

**Extra indexes.** After AUD-01, `createAccount(victim, 99)` deploys a wallet the victim controls and the attacker does not. Index 0, the address the API shows, can no longer be claimed by another identity. The API should keep allocating `index` itself and ignore wallets it did not create.

**Stolen registration assertion.** Submitting the user's assertion first registers the user's key. It does not install the attacker's key. Replay after `IdentityExists` reverts.

**Assertion vs UserOp.** The register challenge is `identityId`. A spend signature is over a UserOp hash. Those collide only as a preimage. Register runs once, before any UserOp.

**Nullifier left out of the hash.** If `authId` is calldata and not part of the typed struct, a watcher can consume a different id or replay the signature under a new id. The id has to be in the EIP-712 payload. Same for `restoreNonce` on cancel.

**Operator replaces the pending key forever.** `replaceRestore` always starts a full delay. A malicious operator can keep resetting it. Iteration 2 treated that as smaller than waiting out one delay and installing a key. Iteration 3 revises that: a retry resets the clock for a user who cannot cancel, so replace has to be limited to a pending restore that cannot execute (AUD-11).

**Swapping the key under a signed operator UserOp.** The 2-of-3 signature covers `callData`, and `callData` contains `(qx, qy)`. The iteration 2 test signs `initiateRestore` for one key and resubmits it with another key. The EntryPoint reverts `AA24`. A fix that reads the new key from storage or from a second unsigned call would drop this binding. Do not do that.

**Compromised method after the AUD-05 fix.** A stolen EOA can still add the attacker's passkey and remove the user's passkey. That is 1-of-n, which this design accepts. What the fix stops is turning restore off and then deleting down to a single key. A stolen method cannot both disable email recovery and erase every other method.

**Timelocked owner.** A compromised owner can schedule a new operator. Users have three days to move funds. The delay floor means they cannot also switch the system to instant restore. Somebody still has to watch the schedule. That is the residual for break-glass ownership.

**Immutable delay.** Raising the delay later needs a new store. That is acceptable while no mainnet store is deployed. If it ever has to change, ship a new store rather than a setter that can go downward.

## New findings

### AUD-08 — the API treats a front-run `register` as success

- **Severity:** High
- **Property:** Theft
- **Where:** [`registerIdentityOnChain`](../commerce/server/identity-onchain.ts) lines 105–108

```ts
if (exists) return true;
```

The function does not read the on-chain method. If AUD-07's first `register` was the attacker's key, this returns success. [`POST /api/identity/passkey/register`](../commerce/server/identity-routes.ts) then creates the counterfactual wallet and returns 201. The user is shown an address whose on-chain key is not theirs.

**Fix, with AUD-07.** On chain, require the assertion. In the API, if the id exists, load the method and require `(qx, qy)` to match. A mismatch is an error, not success.

### AUD-09 — signup writes the database before the chain, and does not undo it

- **Severity:** Medium
- **Property:** Lockout
- **Where:** [`identity-routes.ts`](../commerce/server/identity-routes.ts) lines 620–648

The route inserts the WebAuthn method, then calls `registerIdentityOnChain`. On failure it returns 502 and leaves the row. The next signup sees `counts.webauthn > 0` and returns 409 `identity_exists` before it tries the chain again. The user cannot finish enrollment. The chain may have no method, or, with AUD-08, a different one.

**Fix.** Treat the chain as the source of truth. Register on chain first. Insert the row only after the receipt. If a row exists and the chain method is missing or different, repair or reject. Do not answer 409 from the database alone.

### AUD-10 — YubiKey cannot clear operator power

- **Severity:** Medium
- **Property:** Theft
- **Where:** [`IdentityStore.disableRestore`](../contracts/wallet/IdentityStore.sol) lines 186–191

Covered by the new test. Two methods, one of them a YubiKey, `eoaCount == 0`. `disableRestore` reverts `RestoreRequiresEoa`. The YubiKey still passes `verify`. `restoreEnabled` stays true, so the operator can still start a restore. The launch rule says a YubiKey is enough of a second method to leave email recovery behind.

**Fix.** The AUD-05 change: an IDS1 authorization from any current method, and `methodCount >= 2`. Keep the direct EOA call as a shortcut with the same count check.

## What iteration 2 rechecked and left standing

- One operator identity still cannot start a restore (`AA24`). Two can. The user can cancel during the delay. After the delay the installed key can spend. That is the operator trust assumption, not a bug in the threshold.
- A signature over one `initiateRestore` key does not authorize a different key (`AA24` in this pass).
- Another identity's passkey on the same store still fails validation (AUD-01).
- EntryPoint v0.9, ERC-7821 (EntryPoint or self), checked `uint8` math, and OpenZeppelin's WebAuthn challenge and UV checks are unchanged from iteration 1.
- `rpId` is still not pinned. Still informational. The authenticator binds it.
- Legacy `AdminGuardianRecovery` still cannot drive an identity clone.

No new critical issue turned up in signature verification, the Super Wallet bitset, or `initialize`. The critical item is still AUD-01, and AUD-08 is how the API would hide it.
