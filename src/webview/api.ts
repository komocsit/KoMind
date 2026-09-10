import type { WebviewToHostMsg, HostToWebviewMsg } from "../shared/protocol";

declare const acquireVsCodeApi: () => { postMessage(msg: WebviewToHostMsg): void };
export const vscode = acquireVsCodeApi();
export const send = (msg: WebviewToHostMsg) => vscode.postMessage(msg);
export const onHostMessage = (h: (m: HostToWebviewMsg) => void) => {
  window.addEventListener("message", (e: MessageEvent<HostToWebviewMsg>) => h(e.data));
};
