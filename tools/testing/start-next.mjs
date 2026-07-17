/** Start the production Next app in one owned process for reliable test teardown. */

import { createServer } from "node:http";
import process from "node:process";
import next from "next";

const port = Number(process.env.PORT ?? 3100);
const hostname = process.env.HOSTNAME ?? "127.0.0.1";
const app = next({ dev: false, hostname, port });
await app.prepare();
const handle = app.getRequestHandler();
const server = createServer((request, response) => handle(request, response));

await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(port, hostname, () => {
    server.off("error", reject);
    resolve();
  });
});
process.stdout.write(`RoboArena test web server listening on http://${hostname}:${port}\n`);

let stopping = false;
const shutdown = () => {
  if (stopping) return;
  stopping = true;
  server.close(() => {
    void app.close().finally(() => process.exit(0));
  });
};
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
