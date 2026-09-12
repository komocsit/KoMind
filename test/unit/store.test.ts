import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SessionStore } from "../../src/host/store";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";

let dir: string;
beforeEach(() => { dir = mkdtempSync(path.join(tmpdir(), "jw-")); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe("SessionStore", () => {
  it("appends and reloads events in order", async () => {
    const s = new SessionStore(dir);
    const { id } = s.createSession();
    await s.append(id, { kind: "user", text: "hi", ts: 1 });
    await s.append(id, { kind: "assistantText", text: "hello", ts: 2 });
    expect(await s.load(id)).toEqual([
      { kind: "user", text: "hi", ts: 1 },
      { kind: "assistantText", text: "hello", ts: 2 },
    ]);
  });
  it("lists sessions with first user message", async () => {
    const s = new SessionStore(dir);
    const { id } = s.createSession();
    await s.append(id, { kind: "user", text: "fix the bug", ts: 42 });
    const list = await s.list();
    expect(list).toEqual([{ id, firstUserMessage: "fix the bug", ts: 42, archived: false }]);
  });
  it("uses an image label for an image-only session", async () => {
    const s = new SessionStore(dir);
    const { id } = s.createSession();
    await s.append(id, {
      kind: "user",
      text: "",
      ts: 42,
      images: [{ name: "diagram.png", mediaType: "image/png", data: "aW1hZ2U=" }],
    });
    expect(await s.list()).toEqual([{ id, firstUserMessage: "[Image: diagram.png]", ts: 42, archived: false }]);
  });
  it("archives and restores a session", async () => {
    const s = new SessionStore(dir);
    const { id } = s.createSession();
    await s.append(id, { kind: "user", text: "keep this", ts: 1 });
    await s.setArchived(id, true);
    expect(await s.list()).toEqual([{ id, firstUserMessage: "keep this", ts: 1, archived: true }]);
    await s.setArchived(id, false);
    expect(await s.list()).toEqual([{ id, firstUserMessage: "keep this", ts: 1, archived: false }]);
  });
  it("delete removes the file and archive metadata", async () => {
    const s = new SessionStore(dir);
    const { id } = s.createSession();
    await s.setArchived(id, true);
    await s.delete(id);
    expect(await s.load(id)).toEqual([]);
  });
  it("load on missing session returns empty, does not throw", async () => {
    const s = new SessionStore(dir);
    expect(await s.load("nonexistent")).toEqual([]);
  });
});
