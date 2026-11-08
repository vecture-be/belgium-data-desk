# Security

The Worker fetches from the internet for users in two places: the dataset relay (`/api/dataset-file/<id>`, only files listed in the generated `relay-index.mjs`) and the live answer tools (only the fixed hosts in `HOSTS` in `dov.mjs`). Neither accepts a URL from the caller. If you find a way around that, a way to exhaust the service, or a way to get personal data out of it, report it privately through [GitHub's private vulnerability reporting](https://github.com/vecture-be/belgium-data-desk/security/advisories/new). You will get an answer within a week.

The relay's design and its protections are described in `docs/reference/website-and-relay.md`.
