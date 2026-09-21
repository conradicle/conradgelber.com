# Deploying conradgelber.com

Static site, no build step. Cloudflare Pages serves the repo root as-is.

## 1. Push the repo

Create an empty GitHub repo (e.g. `conradicle/conradgelber.com`) and push `main`:

```bash
git remote add origin git@github.com:conradicle/conradgelber.com.git
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
| Build output directory | `.`                       |
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
minutes. `<link rel="canonical">` already points at the apex, so www serving
the same content is fine for search. If you later want www to 301 to the
apex, add a `_redirects` file with one line:

```
https://www.conradgelber.com/* https://conradgelber.com/:splat 301
```

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
- If you turn on **Cloudflare Web Analytics** later, do it from the dashboard
  with the *automatic* option (Cloudflare injects the beacon at the edge for
  proxied zones). That beacon is a script, so the CSP will need
  `script-src https://static.cloudflareinsights.com` and
  `connect-src https://cloudflareinsights.com` added at the same time or it
  will be blocked silently.
