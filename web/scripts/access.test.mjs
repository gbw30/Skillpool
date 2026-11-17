// The site's only gate, and the address every limit counts by. Run with `npm test`.
import assert from "node:assert/strict";
import { test } from "node:test";
import { accessToken, siteGate, tokenFor } from "../lib/access.ts";
import { clientAddress } from "../lib/attempts.ts";

const DAY = 24 * 60 * 60 * 1000;

test("the access cookie is sealed with the code and lasts 30 days", () => {
  process.env.SITE_ACCESS_CODE = "test-code";
  assert.equal(siteGate(tokenFor("test-code")), "ok");
  assert.equal(tokenFor("wrong"), null);
  assert.equal(siteGate(accessToken("test-code", Date.now() - 29 * DAY)), "ok");
  assert.equal(siteGate(accessToken("test-code", Date.now() - 31 * DAY)), "locked");
  assert.equal(siteGate(accessToken("test-code", Date.now() + 10 * 60_000)), "locked"); // issued in the future
  assert.equal(siteGate(accessToken("another-code")), "locked");
  const [issued, mark] = accessToken("test-code").split(".");
  assert.equal(siteGate(`${Number(issued) - 1}.${mark}`), "locked"); // a changed time breaks the seal
  for (const junk of [undefined, "", "abc", ".", `${issued}.`, `.${mark}`]) assert.equal(siteGate(junk), "locked");
});

test("a visitor is counted by IPv4 address, or by IPv6 /64", () => {
  const from = (forwarded) => clientAddress({ headers: new Headers(forwarded ? { "x-forwarded-for": forwarded } : {}) });
  assert.equal(from("203.0.113.5, 10.0.0.1"), "203.0.113.5");
  assert.equal(from("::ffff:203.0.113.5"), "203.0.113.5");
  assert.equal(from("2001:db8:a:b:1:2:3:4"), "2001:db8:a:b::/64");
  assert.equal(from("2001:0DB8:000a:b::9"), "2001:db8:a:b::/64");
  assert.equal(from("2001:db8::1"), "2001:db8:0:0::/64");
  assert.notEqual(from("2001:db8:a:c::1"), from("2001:db8:a:b::1"));
  assert.equal(from(null), "unknown");
});
