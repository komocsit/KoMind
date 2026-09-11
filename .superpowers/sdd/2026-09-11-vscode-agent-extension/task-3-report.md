# Task 3 Report: Tool executors (pure logic, mock vscode)

## Status: COMPLETE

## Files created
- `src/host/tools.ts` — `ToolContext`, `ToolDef`, `TOOL_DEFS` (4 tools), `resolvePath` (workspace confinement), `executeTool`
- `test/unit/tools.test.ts` — 8 tests with fully mocked `ToolContext` (no vscode dependency)

## TDD sequence
1. **Failing tests written** (verbatim from brief).
2. `npx vitest run test/unit/tools.test.ts` → **FAIL** — `Failed to load url ../../src/host/tools ... Does the file exist?` (module missing, as expected).
3. Implemented `src/host/tools.ts` verbatim from brief.
4. Same command → **PASS**: 8/8 tests (Test Files 1 passed, Tests 8 passed, 855ms).
5. Full suite `npx vitest run` → **3 files, 10/10 tests passed** (no regressions).

## Commit
- `b2a7f84` — `feat: tool executors with workspace path confinement`
  - Explicit adds: `src/host/tools.ts`, `test/unit/tools.test.ts` (no `git add -A`; `.superpowers/` files remain uncommitted/untracked).

## Commands + output summaries
- `npx vitest run test/unit/tools.test.ts` (pre-impl): 1 failed suite — module not found.
- `npx vitest run test/unit/tools.test.ts` (post-impl): 8 passed.
- `npx vitest run`: 10 passed (3 files).
- `npx tsc --noEmit`: reports only pre-existing errors in `src/webview/main.tsx` (missing `@types/react` / `@types/react-dom` from Task 1 scaffolding) — none in `src/host/tools.ts` or `test/unit/tools.test.ts`.

## Deviations from brief
- None. Code used verbatim.

## Self-review against brief checklist
- [x] Step 1: failing tests written (exact brief code)
- [x] Step 2: verified FAIL (module missing)
- [x] Step 3: `src/host/tools.ts` implemented (exact brief code); imports `ToolName` from `../shared/protocol` (Task 2)
- [x] Step 4: verified PASS (8/8)
- [x] Step 5: committed with explicit file paths, planning docs excluded
- [x] Pure logic, no vscode import in `src/host/tools.ts` or the test
- [x] Windows path semantics verified (forward-slash root + `path.resolve`)

## Concerns / pre-existing issues
- `npx tsc --noEmit` fails on `src/webview/main.tsx` due to missing `@types/react` / `@types/react-dom` — pre-existing from scaffolding, not touched here; flagging for a future task (webview build presumably goes through esbuild, which doesn't typecheck).
- Git LF→CRLF warnings on commit (harmless; Windows autocrlf).

## Fix (post-review): normalize absolute paths in resolvePath

- **Finding (Important)**: absolute inputs with traversal (e.g. C:/work/proj/../evil.txt) bypassed the workspace-confinement check because the absolute path was used un-normalized.
- **Change** (src/host/tools.ts): const abs = path.isAbsolute(rel) ? rel : path.resolve(workspaceRoot, rel); -> const abs = path.resolve(workspaceRoot, rel); (resolves unconditionally; confinement check bs !== normRoot && !abs.startsWith(normRoot + path.sep) unchanged).
- **Regression test** added to 	est/unit/tools.test.ts (resolvePath block): rejects C:/work/proj/../evil.txt.
- 
px vitest run test/unit/tools.test.ts: **9/9 passed** (1 file).
- 
pm run test:unit: **11/11 passed** (3 files).
- Commit: f258b5 ix: normalize absolute paths in resolvePath to prevent workspace escape (explicit file adds).
