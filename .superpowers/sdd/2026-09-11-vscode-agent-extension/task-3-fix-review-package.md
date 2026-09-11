## fix diff vs bf258b5^
diff --git a/src/host/tools.ts b/src/host/tools.ts
index 1092116..3a50a9c 100644
--- a/src/host/tools.ts
+++ b/src/host/tools.ts
@@ -15,21 +15,21 @@ export interface ToolDef { name: ToolName; description: string; schema: Record<s
 
 export const TOOL_DEFS: ToolDef[] = [
   { name: "read_file", description: "Read a text file from the workspace. Returns full contents.", schema: { type: "object", properties: { path: { type: "string", description: "Workspace-relative path" } }, required: ["path"] } },
   { name: "list_dir", description: "List entries of a workspace directory.", schema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } },
   { name: "apply_edit", description: "Replace an exact string in a file. oldString must match exactly and appear exactly once.", schema: { type: "object", properties: { path: { type: "string" }, oldString: { type: "string" }, newString: { type: "string" } }, required: ["path", "oldString", "newString"] } },
   { name: "run_terminal", description: "Run a shell command in the workspace. Requires user approval.", schema: { type: "object", properties: { command: { type: "string" }, cwd: { type: "string" } }, required: ["command"] } },
 ];
 
 export function resolvePath(workspaceRoot: string | undefined, rel: string): string {
   if (!workspaceRoot) throw new Error("No workspace folder open.");
-  const abs = path.isAbsolute(rel) ? rel : path.resolve(workspaceRoot, rel);
+  const abs = path.resolve(workspaceRoot, rel);
   const normRoot = path.resolve(workspaceRoot);
   if (abs !== normRoot && !abs.startsWith(normRoot + path.sep)) {
     throw new Error(`Path escapes workspace: ${rel}`);
   }
   return abs;
 }
 
 export async function executeTool(name: string, input: Record<string, unknown>, callId: string, ctx: ToolContext): Promise<{ ok: boolean; output: string }> {
   try {
     switch (name as ToolName) {
diff --git a/test/unit/tools.test.ts b/test/unit/tools.test.ts
index 54cbcbe..5108f79 100644
--- a/test/unit/tools.test.ts
+++ b/test/unit/tools.test.ts
@@ -14,20 +14,23 @@ function mockCtx(overrides: Partial<ToolContext> = {}): ToolContext {
     workspaceRoot: () => "C:/work/proj",
     ...overrides,
   };
 }
 
 describe("resolvePath", () => {
   it("rejects paths escaping the workspace", () => {
     expect(() => resolvePath("C:/work/proj", "../outside.txt")).toThrow();
     expect(() => resolvePath("C:/work/proj", "C:/elsewhere/x.txt")).toThrow();
   });
+  it("rejects absolute paths with traversal escaping the workspace", () => {
+    expect(() => resolvePath("C:/work/proj", "C:/work/proj/../evil.txt")).toThrow();
+  });
   it("accepts relative paths inside workspace", () => {
     expect(resolvePath("C:/work/proj", "src/a.ts")).toBe(path.resolve("C:/work/proj", "src/a.ts"));
   });
 });
 
 describe("executeTool", () => {
   it("read_file returns contents", async () => {
     const r = await executeTool("read_file", { path: "a.txt" }, "c1", mockCtx());
     expect(r).toEqual({ ok: true, output: "file contents" });
   });
