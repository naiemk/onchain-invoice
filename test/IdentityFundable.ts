import { expect } from "chai";
import { identityMayReceiveFunds } from "../commerce/shared/identity-fundable.js";

describe("identity fundable", function () {
  it("allows funds only at two or more methods", function () {
    expect(identityMayReceiveFunds(0)).to.equal(false);
    expect(identityMayReceiveFunds(1)).to.equal(false);
    expect(identityMayReceiveFunds(2)).to.equal(true);
    expect(identityMayReceiveFunds(3)).to.equal(true);
    expect(identityMayReceiveFunds(1.5)).to.equal(false);
  });
});
