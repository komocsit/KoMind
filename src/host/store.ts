import * as fs from "fs";
import * as path from "path";
import type { SessionEvent } from "../shared/protocol";

export class SessionStore {
  constructor(private readonly dir: string) {
    fs.mkdirSync(dir, { recursive: true });
  }
  private file(id: string) { return path.join(this.dir, `${id}.jsonl`); }
  private archiveFile(id: string) { return path.join(this.dir, `${id}.archived`); }
  createSession(): { id: string; path: string } {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const p = this.file(id);
    fs.writeFileSync(p, "");
    return { id, path: p };
  }
  async append(sessionId: string, event: SessionEvent): Promise<void> {
    await fs.promises.appendFile(this.file(sessionId), JSON.stringify(event) + "\n", "utf8");
  }
  async load(sessionId: string): Promise<SessionEvent[]> {
    try {
      const raw = await fs.promises.readFile(this.file(sessionId), "utf8");
      return raw.split("\n").filter((l) => l).map((l) => JSON.parse(l) as SessionEvent);
    } catch { return []; }
  }
  async list(): Promise<{ id: string; firstUserMessage: string; ts: number; archived: boolean }[]> {
    const files = await fs.promises.readdir(this.dir);
    const out: { id: string; firstUserMessage: string; ts: number; archived: boolean }[] = [];
    for (const f of files.filter((f) => f.endsWith(".jsonl"))) {
      const id = f.replace(/\.jsonl$/, "");
      const events = await this.load(id);
      const first = events.find((e) => e.kind === "user");
      if (first && first.kind === "user") {
        const imageLabel = first.images?.length ? `[Image: ${first.images.map((image) => image.name).join(", ")}]` : "";
        out.push({ id, firstUserMessage: first.text || imageLabel, ts: first.ts, archived: fs.existsSync(this.archiveFile(id)) });
      }
    }
    return out.sort((a, b) => b.ts - a.ts);
  }
  async delete(sessionId: string): Promise<void> {
    await Promise.all([
      fs.promises.rm(this.file(sessionId), { force: true }),
      fs.promises.rm(this.archiveFile(sessionId), { force: true }),
    ]);
  }
  async setArchived(sessionId: string, archived: boolean): Promise<void> {
    if (archived) await fs.promises.writeFile(this.archiveFile(sessionId), "", "utf8");
    else await fs.promises.rm(this.archiveFile(sessionId), { force: true });
  }
}
