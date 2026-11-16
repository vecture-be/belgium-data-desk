# Belgium Data Desk — ChatGPT submission package 1.1.0

Connects the production MCP service at https://data.vecture.be/mcp. No account, API key or OAuth credentials are needed. The ZIP contains listing metadata, an evidence-first workflow and an icon, not a frozen copy of the tools or data.

Source: https://github.com/vecture-be/belgium-data-desk/tree/main/plugins/belgium-data-desk
Build: `python3 scripts/package-chatgpt.py` from the source repository.
The deployment pipeline publishes the generated ZIP at https://data.vecture.be/downloads/belgium-data-desk-chatgpt.zip.

## Complete the submission

1. Open https://platform.openai.com/plugins in the verified organization's global-residency project. Choose the verified identity matching the intended public publisher name and upload this ZIP.
2. Check Metadata & Skills. In MCPs, connect the universal HTTPS endpoint with authentication None. Complete the exact domain challenge issued by the portal; organization verification does not replace domain verification.
3. Run the tool scan. Check the five positive and three negative review cases. Exercise them in ChatGPT and record a walkthrough. Backend smoke tests alone do not prove conversational behavior.
4. Supply the reviewer-accessible video URL in Review details. No reviewer credentials are required. Check country availability and the publisher identity, then submit. After approval, select Publish.

The video URL is intentionally omitted so a real recording can be entered in the portal. Never submit a placeholder recording or challenge token.

## Updates

The stable MCP endpoint serves fresh results after compatible deployments. OpenAI continuously reviews new and changed tool definitions before exposing eligible changes. Keep the previous tool contract working during review. A repository URL is source attribution, not an auto-sync setting for the public directory.

Changes to this manifest or bundled workflow require a version bump, rebuilt ZIP and new review. Endpoint path changes also require a new version; changing the MCP origin requires a new plugin. The deployment pipeline rebuilds the download but does not submit or publish it to OpenAI.

The optional report-sending service is currently disabled and not exposed by the live MCP. Before enabling it, update the read-only listing, tool side-effect annotations, review cases and disclosures. Do not silently add message sending under a read-only listing.

Official guidance: https://developers.openai.com/plugins/deploy/submission and https://developers.openai.com/plugins/deploy/app-review (checked 16 November 2026).
