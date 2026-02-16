import http from "node:http";

const PORT = 3000;
const HOST = "0.0.0.0"; // Binding to all interfaces for Codespaces compatibility

const server = http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ status: "success", message: "Server is operational" }));
});

server.listen(PORT, HOST, () => {
  console.log(`[ESM] Server is listening on http://${HOST}:${PORT}`);
});
