"""
Smoke-test the azure-devops MCP server exactly as Kiro would launch it:
  - spawn the stdio server
  - perform the MCP `initialize` handshake
  - send `notifications/initialized`
  - request `tools/list`
Prints a concise PASS/FAIL with server name/version and tool count.
"""
import json
import os
import subprocess
import sys
import threading
import time

CMD = ["cmd", "/c", "npx", "-y", "@azure-devops/mcp@latest",
       "cisidevelopment", "-d", "all", "-a", "pat"]

env = dict(os.environ)
# Kiro maps ${AZURE_DEVOPS_PAT_B64} into PERSONAL_ACCESS_TOKEN
if "AZURE_DEVOPS_PAT_B64" in env:
    env["PERSONAL_ACCESS_TOKEN"] = env["AZURE_DEVOPS_PAT_B64"]

print("launching:", " ".join(CMD))
proc = subprocess.Popen(
    CMD, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
    env=env, text=True, bufsize=1,
)

stderr_lines = []
def drain_stderr():
    for line in proc.stderr:
        stderr_lines.append(line.rstrip())
threading.Thread(target=drain_stderr, daemon=True).start()

def send(obj):
    proc.stdin.write(json.dumps(obj) + "\n")
    proc.stdin.flush()

def read_response(match_id, timeout=90):
    deadline = time.time() + timeout
    while time.time() < deadline:
        line = proc.stdout.readline()
        if not line:
            if proc.poll() is not None:
                return None
            continue
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
        except json.JSONDecodeError:
            continue  # skip non-JSON log noise
        if msg.get("id") == match_id:
            return msg
    return None

try:
    send({"jsonrpc": "2.0", "id": 1, "method": "initialize",
          "params": {"protocolVersion": "2024-11-05",
                     "capabilities": {},
                     "clientInfo": {"name": "kiro-smoke-test", "version": "1.0"}}})
    init = read_response(1)
    if not init:
        print("FAIL: no initialize response (server may need first-run npm download or auth)")
        print("--- stderr tail ---")
        print("\n".join(stderr_lines[-25:]))
        sys.exit(1)
    if "error" in init:
        print("FAIL: initialize returned error:", json.dumps(init["error"]))
        sys.exit(1)
    srv = init.get("result", {}).get("serverInfo", {})
    print(f"PASS handshake: server={srv.get('name')} version={srv.get('version')} "
          f"protocol={init.get('result',{}).get('protocolVersion')}")

    send({"jsonrpc": "2.0", "method": "notifications/initialized", "params": {}})

    send({"jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {}})
    tl = read_response(2)
    if not tl or "result" not in tl:
        print("WARN: tools/list did not return a result")
        print(json.dumps(tl, indent=2) if tl else "(no response)")
        sys.exit(0)
    tools = tl["result"].get("tools", [])
    print(f"PASS tools/list: {len(tools)} tools exposed")
    for t in tools:
        print("   -", t.get("name"))

    # Real authenticated call: list projects. This exercises the PAT.
    print("\n--- authenticated call: core_list_projects ---")
    send({"jsonrpc": "2.0", "id": 3, "method": "tools/call",
          "params": {"name": "core_list_projects", "arguments": {}}})
    call = read_response(3, timeout=90)
    if not call:
        print("FAIL: no response to core_list_projects")
        sys.exit(1)
    if "error" in call:
        print("FAIL: auth/call error:", json.dumps(call["error"]))
        print("--- stderr tail ---")
        print("\n".join(stderr_lines[-15:]))
        sys.exit(1)
    result = call.get("result", {})
    if result.get("isError"):
        print("FAIL: tool reported error (likely PAT invalid/expired or no access):")
        for c in result.get("content", []):
            print("   ", c.get("text", c))
        sys.exit(1)
    # summarize returned content
    texts = [c.get("text", "") for c in result.get("content", []) if c.get("type") == "text"]
    blob = "\n".join(texts)
    print("PASS authenticated call succeeded. Response preview:")
    print(blob[:600] if blob else json.dumps(result)[:600])
finally:
    try:
        proc.terminate()
    except Exception:
        pass
