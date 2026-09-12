import type { HostToWebviewMsg, ToolName } from "../shared/protocol";

export class ApprovalManager {
  private pending = new Map<string, { resolve: (ok: boolean) => void; timer: NodeJS.Timeout; tool: ToolName }>();

  constructor(private readonly post: (msg: HostToWebviewMsg) => void) { }

  request(sessionId: string, callId: string, command: string, tool: ToolName, signal?: AbortSignal): Promise<boolean> {
    if (signal?.aborted) return Promise.resolve(false);
    this.post({ type: "approvalRequest", sessionId, callId, command, tool });
    return new Promise<boolean>((resolve) => {
      const finish = (approved: boolean) => {
        const p = this.pending.get(callId);
        if (!p) return;
        clearTimeout(p.timer);
        this.pending.delete(callId);
        this.post({ type: "approvalResolved", sessionId, callId, approved });
        resolve(approved);
      };
      const timer = setTimeout(() => finish(false), 60_000);
      this.pending.set(callId, { resolve, timer, tool });
      if (signal?.aborted) finish(false);
      else signal?.addEventListener("abort", () => finish(false), { once: true });
    });
  }

  /** Which tool a pending approval belongs to (for "always allow" grants). */
  toolOf(callId: string): ToolName | undefined {
    return this.pending.get(callId)?.tool;
  }

  resolve(callId: string, approved: boolean, sessionId: string): void {
    const p = this.pending.get(callId);
    if (!p) return;
    clearTimeout(p.timer);
    this.pending.delete(callId);
    this.post({ type: "approvalResolved", sessionId, callId, approved });
    p.resolve(approved);
  }
}
