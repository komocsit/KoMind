import type { HostToWebviewMsg } from "../shared/protocol";

export class ApprovalManager {
  private pending = new Map<string, { resolve: (ok: boolean) => void; timer: NodeJS.Timeout }>();

  constructor(private readonly post: (msg: HostToWebviewMsg) => void) {}

  request(sessionId: string, callId: string, command: string): Promise<boolean> {
    this.post({ type: "approvalRequest", sessionId, callId, command });
    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(callId);
        this.post({ type: "approvalResolved", sessionId, callId, approved: false });
        resolve(false);
      }, 60_000);
      this.pending.set(callId, { resolve, timer });
    });
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
