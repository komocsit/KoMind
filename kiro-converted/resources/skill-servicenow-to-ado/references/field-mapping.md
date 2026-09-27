# ServiceNow → Azure DevOps mapping

Defaults, not laws. If the user's Azure DevOps project uses a custom process or the
ServiceNow instance has customised choice lists, ask once and follow their answer.

## Which work item type

| ServiceNow record | Prefix | Azure DevOps type |
|---|---|---|
| Incident | INC | Bug |
| Problem | PRB | Bug (or Issue, if the project separates root-cause work) |
| Requested item | RITM | User Story / Product Backlog Item |
| Catalog task | SCTASK | Task |
| Change request | CHG | Task, usually a child of a Story |
| Change task | CTASK | Task |
| Case | CS | Bug or User Story depending on content |

Process differences to watch: Agile uses **User Story**, Scrum uses **Product Backlog
Item**, CMMI uses **Requirement**. Read the available types from the project rather
than hardcoding one.

## Fields

| ServiceNow | Azure DevOps | Notes |
|---|---|---|
| `number` | Title prefix, Tag | `[INC0012345] ...` — makes both search paths work |
| `short_description` | Title (after the prefix) | Trim to something readable |
| `description` + work notes | Repro Steps (Bug) or Description | Bugs on Agile/Scrum use `Microsoft.VSTS.TCM.ReproSteps`, which is HTML |
| `priority` | Priority | See table below |
| `impact` | Severity | 1 High → `1 - Critical`, 2 Medium → `2 - High`, 3 Low → `3 - Medium` |
| `assignment_group` | Area Path | Only if the org mirrors groups to areas; otherwise use the agreed area |
| `assigned_to` | Assigned To | Match on email, not display name — names collide |
| `opened_at` | mention in description | Do not overwrite `System.CreatedDate` |
| `cmdb_ci` / `business_service` | Tag, or a custom field | Useful for filtering later |
| `sys_id` | link in description | `https://<instance>/nav_to.do?uri=<table>.do?sys_id=<sys_id>` |
| `category` / `subcategory` | Tags | |

## Priority

ServiceNow priority is derived from impact × urgency and runs 1 (highest) to 5.
Azure DevOps priority runs 1 to 4.

| ServiceNow | Azure DevOps |
|---|---|
| 1 – Critical | 1 |
| 2 – High | 1 |
| 3 – Moderate | 2 |
| 4 – Low | 3 |
| 5 – Planning | 4 |

## ServiceNow state codes

Incident (`incident.state`) — the common out-of-box values:

| Value | Meaning |
|---|---|
| 1 | New |
| 2 | In Progress |
| 3 | On Hold |
| 6 | Resolved |
| 7 | Closed |
| 8 | Canceled |

Catalog task (`sc_task.state`): 1 Open, 2 Work in Progress, 3 Closed Complete,
4 Closed Incomplete, 7 Closed Skipped.

Instances customise these constantly. Confirm a value before writing it — reading one
existing ticket in the target state is the quickest check. Setting state 3 (On Hold)
on an incident usually also requires `hold_reason`, and 6/7 usually require
`close_code` and `close_notes`; a PATCH missing them will be rejected or will silently
leave the record inconsistent.

## Status alignment

| Work item state | Suggested ServiceNow state | Work note |
|---|---|---|
| New | 1 New | Work item created, link |
| Active | 2 In Progress | Investigation started |
| Resolved | 2 In Progress | Fix merged, awaiting deployment — do not resolve the ticket yet |
| Closed (deployed & verified) | 6 Resolved | Propose to the user; needs a resolution code |

Deliberate asymmetry: an Azure DevOps item can be Resolved while the ServiceNow ticket
stays open, because the customer has not seen the fix in production yet. Closing the
ticket early is the most common way this workflow annoys a service desk.
