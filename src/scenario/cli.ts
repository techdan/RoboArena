/** Developer-only CLI. Never imported by the app or authoritative room service. */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { serializeReplay } from "../engine/replay.js";
import { runScenario } from "./scenario.js";

const HELP = `RoboArena deterministic scenario runner

Usage:
  npm run scenario -- run <scenario.json> [--seed <string>] [--out <directory>] [--json]
  npm run scenario -- --help

Runs the real engine with a validated local setup, checks expectations, and verifies replay.
--seed overrides turn 1's seed; later turns use <seed>:2, <seed>:3, etc.
--out writes report.json (states/checks), events.json, and canonical replay.json.
      Existing artifact files in this directory are replaced.
--json writes the full report to stdout. Use npm run --silent scenario for clean JSON.
Exit codes: 0 = passed (or no assertions), 1 = assertion/replay failure, 2 = invalid input/I/O.
See docs/scenario-runner.md and scenarios/*.json for the format and examples.
`;

try {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      help: { type: "boolean", short: "h" },
      seed: { type: "string" },
      out: { type: "string" },
      json: { type: "boolean" },
    },
  });
  if (values.help) {
    process.stdout.write(HELP);
  } else {
    if (
      positionals.length !== 2 ||
      positionals[0] !== "run" ||
      values.seed === "" ||
      values.out === ""
    ) {
      throw new Error(`Expected run <scenario.json> with nonempty option values.\n${HELP}`);
    }
    const source = resolve(positionals[1]!);
    const output = values.out === undefined ? undefined : resolve(values.out);
    if (
      output !== undefined &&
      ["report.json", "events.json", "replay.json"].some(
        (name) => resolve(output, name).toLowerCase() === source.toLowerCase(),
      )
    )
      throw new Error("Output would overwrite the input scenario; choose another --out directory.");
    const input: unknown = JSON.parse(await readFile(source, "utf8"));
    const { report, replay } = runScenario(input, values.seed);
    if (output !== undefined) {
      await mkdir(output, { recursive: true });
      await writeFile(resolve(output, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
      await writeFile(
        resolve(output, "events.json"),
        `${JSON.stringify(
          replay.turns.map((turn) => ({
            turnNumber: turn.orders.turnNumber,
            seed: turn.seed,
            events: turn.events,
          })),
          null,
          2,
        )}\n`,
      );
      await writeFile(resolve(output, "replay.json"), `${serializeReplay(replay)}\n`);
    }
    if (values.json) {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    } else {
      process.stdout.write(
        `${report.passed ? "PASS" : "FAIL"} ${report.name}: ${report.turns.length} turn(s), ${report.checks.filter((check) => check.passed).length}/${report.checks.length} assertions, replay ${report.replayVerification.ok ? "verified" : "FAILED"}\n`,
      );
      if (report.checks.length === 0)
        process.stdout.write("No assertions: resolution and replay verification only.\n");
      for (const check of report.checks.filter((entry) => !entry.passed)) {
        process.stdout.write(
          `Assertion ${check.index}: ${JSON.stringify(check.assertion)}\nActual: ${JSON.stringify(check.actual)}\n`,
        );
      }
      if (output !== undefined) process.stdout.write(`Artifacts: ${output}\n`);
    }
    process.exitCode = report.passed ? 0 : 1;
  }
} catch (error) {
  process.stderr.write(
    `Scenario error: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 2;
}
