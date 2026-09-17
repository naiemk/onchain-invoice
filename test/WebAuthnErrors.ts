import { expect } from "chai";
import { mapWebAuthnDomException, WebAuthnError } from "../ui/src/shared/webauthn.js";

describe("WebAuthn error mapping", function () {
  it("maps DOMException names to stable WebAuthnError codes", function () {
    expect(mapWebAuthnDomException(new DOMException("denied", "NotAllowedError")).code).to.equal("cancelled");
    expect(mapWebAuthnDomException(new DOMException("busy", "InvalidStateError")).code).to.equal("busy");
    expect(mapWebAuthnDomException(new DOMException("blocked", "SecurityError")).code).to.equal(
      "security_blocked"
    );
    expect(mapWebAuthnDomException(new DOMException("timeout", "TimeoutError")).code).to.equal("timeout");
    expect(mapWebAuthnDomException(new DOMException("nope", "NotSupportedError")).code).to.equal(
      "not_supported"
    );
    expect(mapWebAuthnDomException(new DOMException("constraint", "ConstraintError")).code).to.equal(
      "not_supported"
    );
  });

  it("preserves existing WebAuthnError instances", function () {
    const original = new WebAuthnError("busy");
    expect(mapWebAuthnDomException(original)).to.equal(original);
  });
});
