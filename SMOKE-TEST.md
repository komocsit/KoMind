# Manual Smoke Test (real endpoint)

Prereq: a valid API key for https://api.justwoker.icu.

1. Open this folder in VS Code, press F5 (Run Extension).
2. In the Extension Development Host: run command "KoMind: Set API Key", paste your key.
3. Open a test workspace folder (File > Open Folder — create one with a small `a.txt`).
4. Open the KoMind sidebar. Type: "What is 2+2?" — expect streaming markdown reply.
5. Type: "Read the file a.txt and tell me what it contains" — expect a tool card and summary.
6. Type: "Change the greeting in a.txt from Hello to Hi" — expect auto-applied edit + diff tab; Ctrl+Z in editor undoes it.
7. Type: "Run the command npm --version" — expect approval card; click Approve — output streams into the card. Try Reject on a second command too.
8. Click "+ New" — chat clears. Use the Sessions dropdown to reload the old session.
9. Report failures with screenshots.
