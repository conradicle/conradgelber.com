# Deploying conradgelber.com

Static site, no build step. Cloudflare Pages serves the repo root as-is.

## 1. Push the repo

Create an empty public GitHub repo at <https://github.com/new> named
`conradgelber.com` under `conradicle` (no README, no .gitignore, no licence:
the repo already has its history). Then:

```bash
git remote add origin https://github.com/conradicle/conradgelber.com.git
git push -u origin main
```

## 2. Create the Pages project

Cloudflare dashboard → **Workers & Pages** → **Create** → **Pages** →
**Connect to Git** → pick the repo.

| Setting                | Value                     |
| ---------------------- | ------------------------- |
| Production branch      | `main`                    |
| Framework preset       | None                      |
| Build command          | *(leave blank)*           |
| Build output directory | `/`                       |
| Root directory         | *(leave blank)*           |

**Save and Deploy.** The first build takes under a minute and lands on
`<project>.pages.dev`. Check that page before attaching the domain.

## 3. Attach the custom domains

Pages project → **Custom domains** → **Set up a custom domain**.

1. Enter `conradgelber.com` → **Continue** → **Activate domain**.
   The zone is already on Cloudflare, so it creates the (flattened) CNAME
   record for you. No manual DNS.
2. Repeat for `www.conradgelber.com`.

Both hostnames go active once the certificate issues, usually within a few
minutes. www does not serve a duplicate: the `_redirects` file in the repo
301s every `www.conradgelber.com` URL to the same path on the apex, and
`<link rel="canonical">` points at the apex as well. Check it with:

```bash
curl -sI https://www.conradgelber.com/ | grep -i "^HTTP\|^location"
```

Expect `301` and `location: https://conradgelber.com/`.

## 4. Verify

```bash
curl -sI https://conradgelber.com/ | grep -i "content-security-policy\|x-content-type\|referrer-policy"
```

You should see the three headers from `_headers`. Then open the site with
DevTools → Network: every request should be same-origin (HTML, `style.css`,
four woff2 files, favicon). The console should be empty.

## Notes

- `_headers` applies to every path (`/*`). The CSP is
  `default-src 'none'` with `style-src`, `font-src`, `img-src` and
  `manifest-src` set to `'self'`. There is no `script-src`, so scripts are
  blocked entirely. The JSON-LD block is a data block, not a script; the
  browser never executes it and the CSP does not apply to it.
- Every deploy is a plain git push. Preview deploys for branches are on by
  default and get their own `*.pages.dev` URL.

## After the first deploy

### Run the live URL through LinkedIn's Post Inspector first

Before adding the site as a Featured card on LinkedIn, open
<https://www.linkedin.com/post-inspector/> and inspect
`https://conradgelber.com/`. LinkedIn caches Open Graph data aggressively,
and a bad first scrape (a 404, a half-deployed page, a missing `og.png`) is
hard to clear afterwards. The inspector both shows you what LinkedIn sees and
forces a fresh scrape. You want: title "Conrad Gelber", the description, and
the 1200x630 `og.png` preview. Only then add the Featured card.

### If you turn on Cloudflare Web Analytics

Do it from the dashboard with the *automatic* option (Cloudflare injects the
beacon at the edge for proxied zones). The beacon is a script, so the CSP in
`_headers` will block it silently unless you add two directives at the same
time:

```
script-src https://static.cloudflareinsights.com; connect-src https://cloudflareinsights.com
```

Append them to the `Content-Security-Policy` line, commit, push, then enable
analytics. It is cookieless and needs no banner.

### Updating alumniOf after graduation (2027)

The JSON-LD Person block in `index.html` deliberately has no `alumniOf`
while you are still enrolled. After graduating, add this property to the
block (after `worksFor`, before `sameAs`):

```json
"alumniOf": {
  "@type": "HighSchool",
  "name": "Miami Beach Senior High School"
},
```

Then paste the page URL into <https://validator.schema.org/> to confirm the
block still parses, and update `<lastmod>` in `sitemap.xml`.
