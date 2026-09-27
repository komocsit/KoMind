---
name: servicenow-to-ado
description: End-to-end workflow for taking a ServiceNow support ticket (INC/RITM/SCTASK/CHG/PRB), pulling its full details over the ServiceNow REST API using credentials from the environment, creating a matching Azure DevOps work item through the Azure DevOps MCP server, then investigating the root cause and shipping a fix linked back to both systems. Use this skill whenever the user mentions a ServiceNow ticket number, says things like "pick up INC0012345", "work this ticket", "create an ADO item from this incident", "triage this support ticket", or asks to investigate or fix anything that originated from ServiceNow — even if they only paste a ticket number with no other instruction. Also use it when the user wants to sync status or work notes back to ServiceNow after finishing a fix.
---

# servicenow-to-ado

# ServiceNow ticket → Azure DevOps work item → fix

There is no ServiceNow MCP server in this environment, so ServiceNow is reached
through its REST API using `scripts/snow.py`. Azure DevOps **is** available over MCP
(authenticated with a PAT), so all work item operations go through MCP tools rather
than raw REST.

The point of this skill is that the two systems stay in sync and the human keeps
control of anything that other people will see. Reading is free; writing to a ticket,
creating a work item, or pushing code needs a confirmation first.

## Preflight

Run these two checks before anything else. They fail fast and save the user from a
half-finished workflow.

1. **ServiceNow credentials.** Confirm the environment has `SNOW_INSTANCE` plus either
   `SNOW_USER`/`SNOW_PASSWORD` or `SNOW_TOKEN`:

   ```bash
   env | grep -c '^SNOW_' || echo "no ServiceNow env vars set"
   ```

   Never print the values, never ask the user to paste a password into the chat, and
   never write credentials into a file, a work item, or a commit. If the variables are
   missing, tell the user to export them in their shell (or add them to a `.env` that
   is gitignored) and stop there.

2. **Azure DevOps MCP.** List the available tools and confirm the Azure DevOps server
   is connected. Tool names vary by server version — the Microsoft server exposes names
   along the lines of `wit_create_work_item`, `wit_get_work_item`,
   `wit_update_work_item`, `wit_add_work_item_comment`, `search_workitem`, and
   `core_list_projects`. Use whatever the tool list actually reports; do not guess a
   name and call it blind. If no Azure DevOps tools are present, say so rather than
   falling back to the `az` CLI or raw REST with a PAT.

Also establish the target **organization**, **project**, and **area path** once, at the
start. If the user has not said, ask — putting a work item in the wrong project is
annoying to undo.

## Step 1 — Pull the ticket

```bash
python scripts/snow.py get INC0012345
python scripts/snow.py journal INC0012345
python scripts/snow.py attachments INC0012345 --download ./ticket-INC0012345
```

`get` returns the curated field set; add `--raw` when a custom `u_*` field matters.
`journal` is where the real story usually lives — the original description is often
one line, and the useful reproduction details are buried in work notes. Read it.
Download attachments when the ticket mentions logs, screenshots, or exports, and
inspect them.

If the ticket is a parent (RITM with child SCTASKs, CHG with CTASKs), run
`related` to see the children and ask which one is in scope.

## Step 2 — Triage before creating anything

Summarise back to the user in a few lines: what is broken, who reported it, what the
impact and priority are, what evidence exists, and what is missing. Then state your
read of the scope and confirm it.

This step exists because ServiceNow tickets are frequently mis-scoped — a "bug" that
is really a config change, or one ticket covering three unrelated problems. Creating a
work item first and discovering that afterwards leaves junk in the backlog.

If the ticket is too vague to act on, draft a clarifying work note for the requester
instead of guessing, and offer to post it (see Step 6).

## Step 3 — Check for an existing work item

Before creating, search Azure DevOps for the ticket number using the MCP search or a
WIQL query. Look in the title, tags, and any ServiceNow reference field. Reopened
incidents and duplicate tickets are common, and a second work item for the same
problem splits the history.

If a match exists, use it and note that instead of creating a new one.

## Step 4 — Create the work item

Create it through the Azure DevOps MCP server using the mapping in
`references/field-mapping.md` (priority, severity, and type mapping live there —
read it before filling fields).

Conventions that make the link traceable in both directions:

- **Title**: `[INC0012345] Short description from the ticket` — the number first, so
  it is searchable and greppable.
- **Description / Repro Steps**: the ServiceNow description plus the relevant journal
  entries, in Markdown or HTML depending on the field's format. Include a link back to
  the ticket: `https://<instance>/nav_to.do?uri=incident.do?sys_id=<sys_id>`.
- **Tags**: `servicenow`, the ticket number, and the ServiceNow category.
- **Area path / iteration**: as agreed in preflight. Do not invent one.

Show the user the fields you intend to send and get a yes before calling the create
tool. After creating, report the work item ID and URL.

Sanitise as you copy. ServiceNow tickets routinely contain caller names, email
addresses, phone numbers, internal hostnames, and sometimes credentials pasted by a
frustrated user. Azure DevOps often has a wider audience than the ticket did. Carry
across what is needed to fix the problem; leave out personal data, and if a
credential appears in the ticket, flag it to the user as something to rotate rather
than copying it anywhere.

## Step 5 — Investigate and fix

Work the problem properly rather than pattern-matching the symptom to a quick patch:

1. **Reproduce** — from the repro steps, the attached logs, or the affected
   environment. If it cannot be reproduced, say so explicitly and describe what was
   tried; that is a legitimate outcome and belongs in the work item.
2. **Locate** — trace the failure to a specific file, function, config, or query.
   Search the repo for the error string, check recent commits touching that path, and
   check whether the problem is code, data, or configuration.
3. **Explain the root cause** before writing the fix, and confirm it holds up against
   the evidence in the ticket (timing, affected users, environment).
4. **Fix** — smallest change that addresses the cause. Add or update a test that fails
   without the fix. Branch and commit using the ticket number so the trail survives:

   ```
   branch:  fix/INC0012345-short-slug
   commit:  fix: <what changed> (INC0012345, AB#4821)
   ```

   `AB#<id>` in the commit message or PR description is what makes Azure DevOps link
   the commit or PR to the work item automatically.
5. **Verify** — run the tests, and state what was actually executed versus what still
   needs the user's environment to confirm.

Post the root cause and the fix summary as a comment on the work item so the
reasoning is not lost in a chat transcript.

Ask before pushing a branch, opening a PR, or deploying anything. Those are visible to
other people.

## Step 6 — Sync status back

Once the fix is verified, update both systems:

- **Azure DevOps**: move the state (Active → Resolved, or whatever the project's
  process uses — read the states from the work item type rather than assuming), and
  link the PR.
- **ServiceNow**: post a work note summarising the diagnosis, the fix, and the work
  item reference.

  ```bash
  python scripts/snow.py note INC0012345 --work-note "Root cause: ... Fix in ADO #4821, PR !123. Awaiting deployment to prod."
  ```

Two distinctions matter here. `--work-note` is internal to the fulfiller group;
`--comment` is visible to the person who raised the ticket, so drafting it for review
first is worth the extra turn. And resolving or closing a ServiceNow ticket is usually
governed by process — a resolution code, a customer confirmation, an SLA clock. Do not
close a ticket unless the user explicitly asks; propose it instead.

## When things go wrong

| Symptom | Likely cause |
|---|---|
| `HTTP 401` from snow.py | Wrong password, or the account requires OAuth/MFA — a bearer token in `SNOW_TOKEN` is the workaround |
| `HTTP 403` | Authenticated but missing a role for that table, commonly `itil` |
| Ticket "not found" but the number is right | Number belongs to a different table — pass `--table` explicitly |
| Connection refused / timeout | Instance is behind VPN or an IP allowlist |
| Azure DevOps tool returns 401/403 | PAT expired or lacks Work Items (Read & Write) scope — the user must reissue it; do not ask them to paste the PAT into the chat |
| Work item create rejects a field | Required fields differ per process (Agile/Scrum/CMMI/custom) — read the work item type definition and retry |

## Reference

- `references/field-mapping.md` — ServiceNow → Azure DevOps field, priority, and state
  mapping, plus ServiceNow state codes. Read this before Step 4.
- `scripts/snow.py` — the ServiceNow client. Run `python scripts/snow.py --help` for
  the full command list.
