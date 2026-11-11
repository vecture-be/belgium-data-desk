# Messages and reports to publishers

Two MCP tools help users tell publishers about problems in their data.

## contact_publisher (always on, read-only)

Builds a draft and a `mailto:` link to the contact the publisher declared in its catalogue record, in the publisher's language. The server sends nothing; the user sends the message from their own mailbox. Without a declared address it points to the publisher's web contact and never guesses an address. Code: `contact.mjs`.

## report_data_issue (off until configured)

Files a report that reaches the publisher only after the reporter confirms it by email. Code: `feedback.mjs`.

| Safeguard | Rule |
|---|---|
| Recipient | Only the contact address in the dataset's catalogue record; callers cannot name one |
| Proof of a person | Confirmation link to the reporter; confirming needs a button press (a POST), so link scanners do not confirm |
| Expiry | Unconfirmed reports are deleted after 48 hours |
| Volume | 3 reports per reporter a day, 10 per 30 days, one pending per reporter, dataset and issue, 100 confirmation emails a day in total |
| Publisher inbox | At most one digest a week per address, reports on the same dataset and issue merged, one-click unsubscribe (`List-Unsubscribe` too) |
| Personal data | Reporter address removed when the digest is sent, shared with the publisher only on opt-in; keyed hash kept 31 days for the limits; public list without personal data at `/feedback/open.json` |

The queue is a SQLite-backed Durable Object (`FeedbackDesk`); a weekly cron trigger cleans it up and sends the digests.

### Switching it on

1. Choose an email provider (the adapter in `feedback.mjs` uses Resend's HTTP API) and verify the sending domain there (SPF, DKIM, DMARC records on the domain).
2. Set the secrets `MAIL_API_KEY` (the provider key) and `FEEDBACK_SECRET` (at least 32 random characters), and the variable `FEEDBACK_MAIL_FROM`, e.g. `Belgium Data Desk <feedback@example.org>`.
3. Deploy. The tool is now listed and reports can be filed and confirmed; digests are held and confirmed reports show on `/feedback/open.json`.
4. After reviewing the first held reports, set `FEEDBACK_DIGEST=send` to release the weekly digests.

Until step 2 is done the tool is not listed and `/feedback/*` pages answer 404 (the public list answers with an empty list).
