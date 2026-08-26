import net from "node:net";
import { spawn } from "node:child_process";

function waitForPort(host, port, timeoutMs = 90000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const socket = net.connect({ host, port }, () => {
        socket.end();
        resolve(undefined);
      });
      socket.on("error", () => {
        socket.destroy();
        if (Date.now() - started > timeoutMs) {
          reject(new Error(`Timeout waiting for ${host}:${port}`));
          return;
        }
        setTimeout(attempt, 1000);
      });
    };
    attempt();
  });
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve(undefined);
      else reject(new Error(`${command} ${args.join(" ")} exited ${code}`));
    });
  });
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const parsed = new URL(databaseUrl);
const dbHost = parsed.hostname;
const dbPort = Number(parsed.port || 3306);

console.log(`Waiting for database ${dbHost}:${dbPort} ...`);
await waitForPort(dbHost, dbPort);
console.log("Database is reachable. Running migrations.");

await run("npx", ["prisma", "migrate", "deploy", "--schema", "server/prisma/schema.prisma"]);

const app = spawn("node", ["server/dist/index.js"], { stdio: "inherit" });
app.on("exit", (code) => process.exit(code ?? 1));
