#!/usr/bin/env python3
"""
Minimal ServiceNow REST client for skills that have no ServiceNow MCP server.

Credentials come from the environment ONLY. Never pass them on the command line
(they leak into shell history and process listings) and never write them into a
file that could be committed.

Required:
  SNOW_INSTANCE   e.g. myorg.service-now.com  (or the full https:// URL)

Auth, pick one:
  SNOW_USER + SNOW_PASSWORD     basic auth (works with a normal or integration user)
  SNOW_TOKEN                    OAuth bearer token

Usage:
  python snow.py get INC0012345
  python snow.py get INC0012345 --raw            # every field, not the curated set
  python snow.py journal INC0012345              # comments + work notes, oldest first
  python snow.py attachments INC0012345
  python snow.py attachments INC0012345 --download ./ticket-files
  python snow.py related INC0012345              # child tasks / linked records
  python snow.py note INC0012345 --work-note "Investigating, ADO #4821 created"
  python snow.py note INC0012345 --comment "Customer-visible update"
  python snow.py set INC0012345 --field state=2 --field assigned_to=abc123sysid

All commands print JSON to stdout so the caller can parse them.
"""

import argparse
import base64
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request

# Ticket number prefix -> table. Extend this if the instance uses custom tables.
PREFIX_TABLE = {
    "INC": "incident",
    "RITM": "sc_req_item",
    "REQ": "sc_request",
    "SCTASK": "sc_task",
    "CHG": "change_request",
    "CTASK": "change_task",
    "PRB": "problem",
    "PTASK": "problem_task",
    "CS": "sn_customerservice_case",
    "TASK": "task",
}

# Fields worth reading for almost any ticket. --raw bypasses this.
CORE_FIELDS = [
    "sys_id", "number", "short_description", "description", "state",
    "priority", "urgency", "impact", "category", "subcategory",
    "assignment_group", "assigned_to", "caller_id", "opened_by",
    "opened_at", "sys_created_on", "sys_updated_on", "due_date",
    "cmdb_ci", "business_service", "close_notes", "resolution_code",
    "correlation_id", "parent", "u_environment",
]


def fail(msg, code=1):
    print(json.dumps({"error": msg}), file=sys.stderr)
    sys.exit(code)


def base_url():
    inst = os.environ.get("SNOW_INSTANCE", "").strip()
    if not inst:
        fail("SNOW_INSTANCE is not set. Export it before running "
             "(e.g. export SNOW_INSTANCE=myorg.service-now.com).")
    if not inst.startswith("http"):
        inst = "https://" + inst
    return inst.rstrip("/")


def auth_header():
    token = os.environ.get("SNOW_TOKEN", "").strip()
    if token:
        return "Bearer " + token
    user = os.environ.get("SNOW_USER", "").strip()
    pwd = os.environ.get("SNOW_PASSWORD", "")
    if user and pwd:
        raw = f"{user}:{pwd}".encode()
        return "Basic " + base64.b64encode(raw).decode()
    fail("No credentials found. Set SNOW_TOKEN, or SNOW_USER and SNOW_PASSWORD.")


def request(path, params=None, method="GET", body=None, binary=False):
    url = base_url() + path
    if params:
        url += "?" + urllib.parse.urlencode(params)
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Authorization", auth_header())
    req.add_header("Accept", "*/*" if binary else "application/json")
    if data:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            payload = resp.read()
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", "replace")[:800]
        hint = ""
        if e.code == 401:
            hint = " Check SNOW_USER/SNOW_PASSWORD, or whether the account needs MFA/OAuth."
        elif e.code == 403:
            hint = " The account authenticated but lacks a role for this table (often needs itil)."
        fail(f"HTTP {e.code} on {path}.{hint} Response: {detail}")
    except urllib.error.URLError as e:
        fail(f"Could not reach {base_url()}: {e.reason}. VPN or network restriction?")
    if binary:
        return payload
    return json.loads(payload.decode("utf-8"))


def table_for(number):
    m = re.match(r"^([A-Za-z]+)", number)
    if not m:
        fail(f"'{number}' does not look like a ticket number.")
    prefix = m.group(1).upper()
    table = PREFIX_TABLE.get(prefix)
    if not table:
        fail(f"Unknown ticket prefix '{prefix}'. Add it to PREFIX_TABLE in snow.py, "
             f"or pass --table explicitly.")
    return table


def flatten(record):
    """sysparm_display_value=all returns {'field': {'value':..,'display_value':..}}.
    Collapse to a readable dict, keeping the sys_id behind reference fields."""
    out = {}
    for key, val in record.items():
        if isinstance(val, dict):
            disp = val.get("display_value", "")
            value = val.get("value", "")
            if disp and value and disp != value:
                out[key] = {"display": disp, "value": value}
            else:
                out[key] = disp or value
        else:
            out[key] = val
    return out


def fetch_record(number, table=None, raw=False):
    table = table or table_for(number)
    params = {
        "sysparm_query": f"number={number}",
        "sysparm_display_value": "all",
        "sysparm_limit": "1",
    }
    if not raw:
        params["sysparm_fields"] = ",".join(CORE_FIELDS)
    result = request(f"/api/now/table/{table}", params).get("result", [])
    if not result:
        fail(f"{number} not found in table '{table}'. "
             f"Either the number is wrong or the account cannot read that table.")
    return table, flatten(result[0])


def sys_id_of(record):
    sid = record.get("sys_id")
    return sid["value"] if isinstance(sid, dict) else sid


def cmd_get(args):
    table, rec = fetch_record(args.number, args.table, args.raw)
    print(json.dumps({"table": table, "record": rec}, indent=2))


def cmd_journal(args):
    table, rec = fetch_record(args.number, args.table)
    sid = sys_id_of(rec)
    params = {
        "sysparm_query": f"element_id={sid}^ORDERBYsys_created_on",
        "sysparm_fields": "sys_created_on,sys_created_by,element,value",
        "sysparm_limit": "200",
    }
    entries = request("/api/now/table/sys_journal_field", params).get("result", [])
    print(json.dumps({"number": args.number, "entries": entries}, indent=2))


def cmd_attachments(args):
    table, rec = fetch_record(args.number, args.table)
    sid = sys_id_of(rec)
    params = {"sysparm_query": f"table_sys_id={sid}", "sysparm_limit": "100"}
    files = request("/api/now/attachment", params).get("result", [])
    listing = [{"sys_id": f["sys_id"], "file_name": f["file_name"],
                "content_type": f.get("content_type"), "size_bytes": f.get("size_bytes")}
               for f in files]
    if args.download:
        os.makedirs(args.download, exist_ok=True)
        for f in listing:
            blob = request(f"/api/now/attachment/{f['sys_id']}/file", binary=True)
            safe = re.sub(r"[^A-Za-z0-9._-]", "_", f["file_name"])
            path = os.path.join(args.download, safe)
            with open(path, "wb") as fh:
                fh.write(blob)
            f["saved_to"] = path
    print(json.dumps({"number": args.number, "attachments": listing}, indent=2))


def cmd_related(args):
    table, rec = fetch_record(args.number, args.table)
    sid = sys_id_of(rec)
    out = {"number": args.number, "children": [], "parent": rec.get("parent")}
    for child_table in ("sc_task", "incident", "change_task", "problem_task"):
        params = {
            "sysparm_query": f"parent={sid}",
            "sysparm_fields": "number,short_description,state,assigned_to",
            "sysparm_limit": "50",
        }
        try:
            rows = request(f"/api/now/table/{child_table}", params).get("result", [])
        except SystemExit:
            continue
        for r in rows:
            r["table"] = child_table
            out["children"].append(r)
    print(json.dumps(out, indent=2))


def cmd_note(args):
    if not args.work_note and not args.comment:
        fail("Pass --work-note (internal) or --comment (customer-visible).")
    table, rec = fetch_record(args.number, args.table)
    sid = sys_id_of(rec)
    body = {}
    if args.work_note:
        body["work_notes"] = args.work_note
    if args.comment:
        body["comments"] = args.comment
    request(f"/api/now/table/{table}/{sid}", method="PATCH", body=body)
    print(json.dumps({"number": args.number, "updated": list(body.keys())}, indent=2))


def cmd_set(args):
    table, rec = fetch_record(args.number, args.table)
    sid = sys_id_of(rec)
    body = {}
    for pair in args.field:
        if "=" not in pair:
            fail(f"--field expects key=value, got '{pair}'.")
        k, v = pair.split("=", 1)
        body[k.strip()] = v
    res = request(f"/api/now/table/{table}/{sid}", method="PATCH", body=body)
    print(json.dumps({"number": args.number, "applied": body,
                      "state": res.get("result", {}).get("state")}, indent=2))


def main():
    p = argparse.ArgumentParser(description="ServiceNow REST helper")
    sub = p.add_subparsers(dest="cmd", required=True)

    def common(sp):
        sp.add_argument("number", help="Ticket number, e.g. INC0012345")
        sp.add_argument("--table", help="Override the inferred table")

    g = sub.add_parser("get"); common(g)
    g.add_argument("--raw", action="store_true", help="Return all fields")
    g.set_defaults(func=cmd_get)

    j = sub.add_parser("journal"); common(j); j.set_defaults(func=cmd_journal)

    a = sub.add_parser("attachments"); common(a)
    a.add_argument("--download", metavar="DIR", help="Save files to DIR")
    a.set_defaults(func=cmd_attachments)

    r = sub.add_parser("related"); common(r); r.set_defaults(func=cmd_related)

    n = sub.add_parser("note"); common(n)
    n.add_argument("--work-note")
    n.add_argument("--comment")
    n.set_defaults(func=cmd_note)

    s = sub.add_parser("set"); common(s)
    s.add_argument("--field", action="append", default=[], help="key=value, repeatable")
    s.set_defaults(func=cmd_set)

    args = p.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
