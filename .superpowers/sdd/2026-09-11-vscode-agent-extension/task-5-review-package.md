## git log
939fd36 feat: JSONL session store
6bd4198 feat: anthropic-compatible provider with streaming and retry

## diff stat

 src/host/store.ts       | 39 +++++++++++++++++++++++++++++++++++++++
 test/unit/store.test.ts | 39 +++++++++++++++++++++++++++++++++++++++
 2 files changed, 78 insertions(+)

## diff

diff --git a/src/host/store.ts b/src/host/store.ts
new file mode 100644
index 0000000..8edd4e9
--- /dev/null
+++ b/src/host/store.ts
@@ -0,0 +1,39 @@
+import * as fs from "fs";
+import * as path from "path";
+import type { SessionEvent } from "../shared/protocol";
+
+export class SessionStore {
+  constructor(private readonly dir: string) {
+    fs.mkdirSync(dir, { recursive: true });
+  }
+  private file(id: string) { return path.join(this.dir, `${id}.jsonl`); }
+  createSession(): { id: string; path: string } {
+    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
+    const p = this.file(id);
+    fs.writeFileSync(p, "");
+    return { id, path: p };
+  }
+  async append(sessionId: string, event: SessionEvent): Promise<void> {
+    await fs.promises.appendFile(this.file(sessionId), JSON.stringify(event) + "\n", "utf8");
+  }
+  async load(sessionId: string): Promise<SessionEvent[]> {
+    try {
+      const raw = await fs.promises.readFile(this.file(sessionId), "utf8");
+      return raw.split("\n").filter((l) => l).map((l) => JSON.parse(l) as SessionEvent);
+    } catch { return []; }
+  }
+  async list(): Promise<{ id: string; firstUserMessage: string; ts: number }[]> {
+    const files = await fs.promises.readdir(this.dir);
+    const out: { id: string; firstUserMessage: string; ts: number }[] = [];
+    for (const f of files.filter((f) => f.endsWith(".jsonl"))) {
+      const id = f.replace(/\.jsonl$/, "");
+      const events = await this.load(id);
+      const first = events.find((e) => e.kind === "user");
+      if (first && first.kind === "user") out.push({ id, firstUserMessage: first.text, ts: first.ts });
+    }
+    return out.sort((a, b) => b.ts - a.ts);
+  }
+  async delete(sessionId: string): Promise<void> {
+    await fs.promises.rm(this.file(sessionId), { force: true });
+  }
+}
diff --git a/test/unit/store.test.ts b/test/unit/store.test.ts
new file mode 100644
index 0000000..220acd9
--- /dev/null
+++ b/test/unit/store.test.ts
@@ -0,0 +1,39 @@
+import { describe, it, expect, beforeEach, afterEach } from "vitest";
+import { SessionStore } from "../../src/host/store";
+import { mkdtempSync, rmSync } from "fs";
+import { tmpdir } from "os";
+import path from "path";
+
+let dir: string;
+beforeEach(() => { dir = mkdtempSync(path.join(tmpdir(), "jw-")); });
+afterEach(() => { rmSync(dir, { recursive: true, force: true }); });
+
+describe("SessionStore", () => {
+  it("appends and reloads events in order", async () => {
+    const s = new SessionStore(dir);
+    const { id } = s.createSession();
+    await s.append(id, { kind: "user", text: "hi", ts: 1 });
+    await s.append(id, { kind: "assistantText", text: "hello", ts: 2 });
+    expect(await s.load(id)).toEqual([
+      { kind: "user", text: "hi", ts: 1 },
+      { kind: "assistantText", text: "hello", ts: 2 },
+    ]);
+  });
+  it("lists sessions with first user message", async () => {
+    const s = new SessionStore(dir);
+    const { id } = s.createSession();
+    await s.append(id, { kind: "user", text: "fix the bug", ts: 42 });
+    const list = await s.list();
+    expect(list).toEqual([{ id, firstUserMessage: "fix the bug", ts: 42 }]);
+  });
+  it("delete removes the file", async () => {
+    const s = new SessionStore(dir);
+    const { id } = s.createSession();
+    await s.delete(id);
+    expect(await s.load(id)).toEqual([]);
+  });
+  it("load on missing session returns empty, does not throw", async () => {
+    const s = new SessionStore(dir);
+    expect(await s.load("nonexistent")).toEqual([]);
+  });
+});
