import http from "http";

export function startMockServer(port: number): Promise<http.Server> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      if (req.url?.includes("/v1/messages")) {
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        res.write(`event: content_block_delta\ndata: ${JSON.stringify({ type: "content_block_delta", delta: { type: "text_delta", text: "Mock reply." } })}\n\n`);
        res.write(`event: message_stop\ndata: ${JSON.stringify({ type: "message_stop" })}\n\n`);
        res.end();
      } else { res.writeHead(404).end(); }
    });
    server.listen(port, () => resolve(server));
  });
}
