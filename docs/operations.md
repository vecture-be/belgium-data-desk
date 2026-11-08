# Operating the hosted instance (data.vecture.be)

## Where it runs

- Cloudflare account dedicated to Belgium Data Desk (Workers free plan). Worker `belgium-data-desk`, `https://belgium-data-desk.belgian-data.workers.dev`.
- Deploys come from `.github/workflows/deploy.yml` on push to `main`, weekly (Monday 04:43 UTC, catalogue refresh) and after the Sunday link-health probe.
- Repository settings it needs: secrets `CLOUDFLARE_API_TOKEN` (scoped: Workers Scripts Edit, Workers Routes Edit, Account Analytics Read) and `CLOUDFLARE_ACCOUNT_ID`; variables `PUBLIC_URL` (the address the post-deploy smoke test calls) and `GOOGLE_SITE_VERIFICATION` (the Search Console token, already public in the page).
- One-time account step: enable Workers Analytics Engine in the dashboard (Workers & Pages → Analytics Engine). Until then a deploy fails with error 10089, because `wrangler.jsonc` binds `MCP_USAGE`.

## Health checks

```bash
node scripts/smoke-mcp.mjs https://data.vecture.be     # every tool once, exit 1 on failure
node scripts/verify-live.mjs https://data.vecture.be   # 56 integrity checks
```

CPU per request is in Workers Logs (observability is on). The free plan allows 10 ms per request. MCP searches take about 1-4 ms once an isolate has cached the index shards it uses.

## Moving data.vecture.be off the Netlify proxy

Today: `data.vecture.be` CNAME → Netlify, which proxies to the old shared account's `belgium-data-desk.vct-cloud.workers.dev`. vecture.be DNS is at Nomeo (ns53). CAA allows only `letsencrypt.org` and `pki.goog`; both are CAs Cloudflare uses, so no change is needed.

Before either route: run both health checks against the new workers.dev URL and confirm that the new deployment includes the verification tag.

### Route A: vecture.be DNS on the new Cloudflare account (free)

1. Export every vecture.be record from the Nomeo panel (MX `avas*.cloudemail.be`, SPF, DMARC, all DKIM selectors, the `MS=` and Google TXT records, CAA, apex A `75.2.60.5`, `www` CNAME to Netlify, and any others).
2. Add the zone `vecture.be` to the new account (it stays pending and changes nothing yet). Recreate every record as **DNS only** (grey cloud), except `data`, which you leave out.
3. Compare the zone with the export, record by record.
4. Add the Worker Custom Domain `data.vecture.be` (`routes: [{ "pattern": "data.vecture.be", "custom_domain": true }]` in `wrangler.jsonc`, then deploy).
5. Change the nameservers at Nomeo to the two Cloudflare gives you. The old records keep answering while the change propagates (up to 24-48 h).
6. Check: mail still arrives, `vecture.be` and `www` still serve the Netlify site, `dig data.vecture.be` shows Cloudflare addresses, both health checks pass on `https://data.vecture.be`.

Rollback: set the Nomeo nameservers back. The Nomeo zone was never changed, so the previous state returns as resolvers expire their cache.

### Route B: Cloudflare for SaaS custom hostname (vecture.be stays at Nomeo)

Needs a domain whose zone is on the new account (call it `example.org`).

1. On `example.org`: enable Cloudflare for SaaS, create a proxied record `fallback.example.org`, and set it as the fallback origin. Add a Worker route `*/*` on the zone, or a route for `data.vecture.be/*`.
2. Add the custom hostname `data.vecture.be` (certificate authority: Google or Let's Encrypt, as CAA allows). Put the TXT record Cloudflare shows at Nomeo.
3. At Nomeo, change `data` CNAME from `stunning-pastelito-8192f7.netlify.app` to `fallback.example.org`. TTL is 3600 s.
4. Same checks as in Route A, step 6.

Rollback: point the `data` CNAME back at Netlify. The proxy and the old worker are untouched until the clean-up below.

### After cutover (wait at least 24 h, longer than any DNS cache)

1. Set the repository variable `PUBLIC_URL` to `https://data.vecture.be`.
2. In the previous (private) deployment pipeline: stop deploying and link-probing Belgium Data Desk. Replace the app on the old account with a worker that answers `301` to `https://data.vecture.be` + path. That moves the URLs Google still holds for the old workers.dev host. Remove the `data.vecture.be` proxy rule and domain alias from the Netlify site.
3. Point the SEO ops and dashboard collectors that read the old account's `MCP_USAGE` dataset at the new account.
4. Optionally set `workers_dev: false`. Nothing links to the new workers.dev host.

Do not do step 2 before DNS has settled. While some resolvers still send traffic to Netlify, a redirecting old worker would loop those visitors.
