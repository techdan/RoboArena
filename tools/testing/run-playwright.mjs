/** Run Playwright with production services and reliable Windows process-tree teardown. */

import { spawn } from "node:child_process";
import { get } from "node:http";
import { resolve } from "node:path";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath, URL } from "node:url";

const projectRoot = fileURLToPath(new URL("../../", import.meta.url));
const nextServer = fileURLToPath(new URL("./start-next.mjs", import.meta.url));
const playwrightBin = fileURLToPath(
  new URL("../../node_modules/@playwright/test/cli.js", import.meta.url),
);
const roomMode = process.argv.includes("--room");
const forwardedPlaywrightArgs = process.argv.slice(2).filter((argument) => argument !== "--room");
const webPort = Number(process.env.PLAYWRIGHT_WEB_PORT ?? 3100);
const roomPort = Number(process.env.PLAYWRIGHT_ROOM_PORT ?? 3001);
const webUrl = `http://127.0.0.1:${webPort}/`;
const roomUrl = `http://127.0.0.1:${roomPort}/health`;

const waitForExit = (child) =>
  new Promise((resolveExit, reject) => {
    if (child.exitCode !== null) {
      resolveExit(child.exitCode);
      return;
    }
    child.once("exit", (code) => resolveExit(code ?? 1));
    child.once("error", reject);
  });

const startService = (label, command, args, url, env = process.env) => ({
  label,
  url,
  child: spawn(command, args, {
    cwd: projectRoot,
    env,
    stdio: "inherit",
    windowsHide: true,
  }),
});

const serviceIsReady = (url) =>
  new Promise((resolveReady) => {
    const request = get(url, (response) => {
      response.resume();
      resolveReady((response.statusCode ?? 500) < 500);
    });
    request.setTimeout(1_000, () => request.destroy());
    request.once("error", () => resolveReady(false));
  });

const occupiedTargets = [
  { label: "web", url: webUrl },
  ...(roomMode ? [{ label: "room", url: roomUrl }] : []),
];
for (const target of occupiedTargets) {
  if (await serviceIsReady(target.url)) {
    const hint =
      target.label === "web"
        ? "Set PLAYWRIGHT_WEB_PORT to an unused port."
        : `Set PLAYWRIGHT_ROOM_PORT to an unused port (current: ${roomPort}).`;
    throw new Error(`Playwright ${target.label} port is already in use at ${target.url}. ${hint}`);
  }
}

const services = [
  startService("Next server", process.execPath, [nextServer], webUrl, {
    ...process.env,
    HOSTNAME: "127.0.0.1",
    PORT: String(webPort),
  }),
];
if (roomMode) {
  services.push(
    startService("room server", process.execPath, ["--import", "tsx", "server/index.ts"], roomUrl, {
      ...process.env,
      PORT: String(roomPort),
      ROOM_DATABASE_PATH: resolve(
        projectRoot,
        "test-results",
        `phase8-browser-${process.pid}.sqlite`,
      ),
    }),
  );
}

const waitForService = async (service) => {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (service.child.exitCode !== null) {
      throw new Error(`${service.label} exited before becoming ready (${service.child.exitCode}).`);
    }
    if (await serviceIsReady(service.url)) {
      await delay(100);
      if (service.child.exitCode !== null) {
        throw new Error(
          `${service.label} exited before becoming ready (${service.child.exitCode}).`,
        );
      }
      return;
    }
    await delay(250);
  }
  throw new Error(`${service.label} did not become ready at ${service.url}.`);
};

const stopService = async (service) => {
  const { child, label, url } = service;
  if (child.exitCode !== null || child.pid === undefined) return;
  if (process.platform === "win32") {
    const serviceExit = waitForExit(child);
    child.kill("SIGTERM");
    await Promise.race([serviceExit, delay(3_000)]);
    if (child.exitCode !== null) return;
    if (!(await serviceIsReady(url))) {
      child.unref();
      return;
    }
    const taskkill = spawn(
      `${process.env.SystemRoot ?? "C:\\Windows"}\\System32\\taskkill.exe`,
      ["/pid", String(child.pid), "/T", "/F"],
      { stdio: "ignore", windowsHide: true },
    );
    const taskkillExit = await waitForExit(taskkill);
    if (taskkillExit !== 0) {
      await Promise.race([serviceExit, delay(1_000)]);
      if (child.exitCode === null)
        throw new Error(`Could not stop ${label} process tree (${taskkillExit}).`);
    } else await serviceExit;
    return;
  }
  const serviceExit = waitForExit(child);
  child.kill("SIGTERM");
  await Promise.race([serviceExit, delay(3_000)]);
  if (child.exitCode === null) {
    child.kill("SIGKILL");
    await serviceExit;
  }
};

let stopPromise;
const stopServices = () => {
  stopPromise ??= Promise.allSettled([...services].reverse().map(stopService)).then((results) => {
    const failure = results.find((result) => result.status === "rejected");
    if (failure?.status === "rejected") throw failure.reason;
  });
  return stopPromise;
};

let exitCode;
try {
  await Promise.all(services.map(waitForService));
  const playwrightArgs = ["test", ...forwardedPlaywrightArgs];
  if (roomMode) playwrightArgs.push("--config", "playwright.room.config.ts");
  const playwright = spawn(process.execPath, [playwrightBin, ...playwrightArgs], {
    cwd: projectRoot,
    env: {
      ...process.env,
      PLAYWRIGHT_BASE_URL: webUrl,
      PLAYWRIGHT_EXTERNAL_SERVER: "true",
    },
    stdio: ["inherit", "inherit", "inherit", "ipc"],
    windowsHide: true,
  });
  const testsCompleted = new Promise((resolveCompleted) => {
    playwright.on("message", (message) => {
      if (message === "playwright-tests-complete") resolveCompleted();
    });
  });
  const playwrightExit = waitForExit(playwright);
  const firstCompletion = await Promise.race([
    playwrightExit.then((code) => ({ type: "exit", code })),
    testsCompleted.then(() => ({ type: "tests-complete" })),
  ]);
  if (firstCompletion.type === "tests-complete") {
    await stopServices();
    exitCode = await playwrightExit;
  } else {
    exitCode = firstCompletion.code;
  }
} finally {
  await stopServices();
}

process.exitCode = exitCode ?? 1;
