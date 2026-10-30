import test from "node:test";
import assert from "node:assert/strict";
import { renderConnect, webUrl } from "../scripts/build-connect.mjs";
import profile from "../connect/profile.mjs";

test("incomplete and unsafe social URLs never become live links", () => {
  for (const url of [null, "", "#", "YOUR_INSTAGRAM_URL", "https://example.com/user", "javascript:alert(1)", "http://instagram.com/user", "https://user:secret@example.net", "https://instagram.com/<handle>"]) {
    assert.equal(webUrl(url), null, String(url));
    const html = renderConnect({ ...profile, social: { ...profile.social, instagram: url } });
    assert.match(html, /aria-disabled="true"/);
    assert.match(html, /Not linked yet/);
    assert.doesNotMatch(html, /href="(?:javascript:|#"|YOUR_|http:)/);
  }
});

test("profile text is escaped and initials work without a photo", () => {
  const html = renderConnect({ ...profile, name: '<img src=x onerror="alert(1)">', image: null });
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /&lt;img/);
  assert.match(html, /class="connect-photo initials"/);
});

test("HTML works without runtime scripts and includes server-readable sharing metadata", () => {
  const html = renderConnect(profile);
  assert.doesNotMatch(html, /<script/);
  assert.match(html, /rel="canonical" href="https:\/\/conradgelber.com\/connect\/"/);
  assert.match(html, /property="og:image" content="https:\/\/conradgelber.com\/img\/og-image-2026.jpg"/);
  for (const url of Object.values(profile.social)) assert.ok(html.includes(`href="${webUrl(url)}"`));
  assert.match(html, /<main id="main"/);
});
