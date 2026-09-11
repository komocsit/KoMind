# Task 10: Real-endpoint smoke test + polish (README)

**Files:**
- Create: `README.md`
- Modify: fixes as found (any file)

**Interfaces:**
- Consumes: completed extension (all tasks).
- Produces: verified working extension against https://api.justwoker.icu + README.

Context notes for the implementer:
- The extension runs via F5 (Extension Development Host). You CANNOT interactively use the VS Code UI from a terminal, so the interactive smoke checklist must be executed by the human user. Your job: (a) run the full automated verification (unit + integration + compile + tsc), (b) fix any defects the automated checks surface, (c) write the README, (d) write a SMOKE-TEST.md checklist file the human can follow with the real API key.

- [ ] **Step 1: Full automated verification**

```powershell
npm run compile; npm run test:unit; npm run test:integration; npx tsc --noEmit
```

Expected: all clean. Fix any defects found; re-run.

- [ ] **Step 2: Static pre-smoke checks (code inspection, no UI)**

Verify in code (read the files, confirm present — fix if missing):
1. Webview HTML (extension.ts html method) — the page has NO Content-Security-Policy meta tag yet. ADD one: `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src ${cspSource} 'unsafe-inline'; style-src ${cspSource} 'unsafe-inline'; img-src ${cspSource} data:;">` where cspSource = webview.cspSource. (script-src needs 'unsafe-inline'? No — the script is loaded from a file via nonce-less src. Use: script-src ${cspSource}; — module script loaded from asWebviewUri is allowed by cspSource. Keep style-src unsafe-inline for React inline styles.)
2. New-session bootstrap: when the host starts a session (startSession), it posts `loadEvents` with the new sessionId BEFORE any user message — verify the webview's sessionIdRef gets set from that message (App.tsx loadEvents case sets sessionIdRef.current = m.sessionId — confirm; if the host's newSession command posts `{type:"newSession"}` only, the webview clears cards but sessionIdRef keeps the OLD id — fix by having the host also post loadEvents with the new session id, or the webview handle newSession by requesting session list; choose the host-side fix: after posting newSession, also post loadEvents with the new sessionId).
3. `retry` semantics: webview sends retry with sessionId — host sends "(retry)" as a user message — acceptable v1.

- [ ] **Step 3: Write `SMOKE-TEST.md`** — a human-executable checklist:

```
# Manual Smoke Test (real endpoint)

1. Open this folder in VS Code, press F5 (Run Extension).
2. In the Extension Development Host: run command "Justwoker: Set API Key", paste your key.
3. Open a test workspace folder (File > Open Folder — create one with a small a.txt).
4. Open the Justwoker Agent sidebar. Type: "What is 2+2?" — expect streaming markdown reply.
5. Type: "Read the file a.txt and tell me what it contains" — expect a tool card and summary.
6. Type: "Change the greeting in a.txt from Hello to Hi" — expect auto-applied edit + diff tab; Ctrl+Z in editor undoes it.
7. Type: "Run the command npm --version" — expect approval card; click Approve — output streams into the card. Try Reject on a second command too.
8. Click "+ New" — chat clears. Use the Sessions dropdown to reload the old session.
9. Report failures with screenshots.
```

- [ ] **Step 4: Write `README.md`**

Cover: project title + one-paragraph description; dev setup (npm install, npm run watch, F5); set API key command; settings table (justwokerAgent.baseUrl default https://api.justwoker.icu, model default gpt-5.6-sol, maxTokens 4096, autoApproveEdits true, autoApproveTerminal false); tool permission model (edits auto-applied with diff + undo; terminal requires approval, 60s timeout auto-reject); architecture summary (extension host: provider/agent/tools/approvals/store; webview: React chat; typed postMessage protocol in src/shared); test commands (npm run test:unit, npm run test:integration); repo layout.

- [ ] **Step 5: Final commit** — `git add README.md SMOKE-TEST.md src/host/extension.ts src/webview <any other fixed files>; git commit -m "docs: README, smoke-test checklist, webview CSP hardening"`

Then re-run the full verification once more and confirm clean.
