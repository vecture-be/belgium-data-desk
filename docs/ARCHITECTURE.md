# Architecture

![Belgium Data Desk — mobile architecture](./architecture-mobile.svg)

[Detailed architecture](./architecture.svg) · [Edit the draw.io diagram](./architecture.drawio)

**Maintainer note.** Keep one public application repository, one Cloudflare Worker and one stable `/mcp` endpoint. New domains are independently testable, reuse safe upstream access and shared identifiers, and return source-backed answers. Claude remains a thin client; preserve existing tool contracts.

**Current:** DOV, Statbel, IRCEL, VMM, static catalogue, scheduled harvesting and deployment workflows. **Planned:** Waterinfo, GIPOD and stricter domain isolation. No KV or Durable Objects today. Secrets stay outside Git; retire legacy deployment jobs only after verifying the new pipeline.
