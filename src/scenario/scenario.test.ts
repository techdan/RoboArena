/** Harness contracts: real fixtures, repeatability, validation and observable CLI failures. */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { deserializeReplay, serializeReplay, verifyReplay } from "../engine/replay.js";
import { runScenario } from "./scenario.js";
import type { Scenario } from "./scenario.js";

const example = (name = "movement"): Scenario =>
  JSON.parse(readFileSync(resolve(`scenarios/${name}.json`), "utf8")) as Scenario;
const cli = (args: string[]) =>
  spawnSync(process.execPath, ["--import", "tsx", "src/scenario/cli.ts", ...args], {
    encoding: "utf8",
  });

describe("scenario runner", () => {
  it.each(["movement", "wall-blocked-shot", "missile-friendly-fire"])(
    "runs and verifies %s against the real engine",
    (name) => {
      const result = runScenario(example(name));
      expect(result.report.passed).toBe(true);
      expect(result.report.checks.length).toBeGreaterThan(0);
      expect(verifyReplay(deserializeReplay(serializeReplay(result.replay)))).toEqual({ ok: true });
    },
  );

  it("keeps the same seed byte-identical, preserves inputs, and carries state across turns", () => {
    const input = example();
    const before = JSON.stringify(input);
    const first = runScenario(input, "42");
    expect(JSON.stringify(runScenario(input, "42"))).toBe(JSON.stringify(first));
    expect(JSON.stringify(input)).toBe(before);
    expect(first.replay.turns.map((turn) => turn.seed)).toEqual(["42", "42:2"]);
    expect(first.report.turns[1]!.state).toMatchObject({
      turnNumber: 3,
      lastKnownMarkers: expect.any(Array),
    });
  });

  it("reports wrong expectations with actual values, rather than throwing or silently passing", () => {
    const input = example();
    input.assertions = [{ kind: "robot", turn: 1, robotId: "runner", equals: { hp: 1 } }];
    const result = runScenario(input);
    expect(result.report.passed).toBe(false);
    expect(result.report.checks[0]).toMatchObject({ passed: false, actual: { hp: 140 } });
  });

  it("rejects malformed setups, misspelled expectations and unknown references", () => {
    const input = example();
    expect(() => runScenario({ ...input, formatVersion: 2 })).toThrow();
    expect(() => runScenario({ ...input, teams: [input.teams[0], input.teams[0]] })).toThrow(
      "Duplicate team",
    );
    input.teams[0]!.robots[0]!.hp = 999;
    expect(() => runScenario(input)).toThrow("HP exceeds");
    delete input.teams[0]!.robots[0]!.hp;
    input.teams[0]!.robots[0]!.position = { x: 99, y: 1 };
    expect(() => runScenario(input)).toThrow("outside arena");
    expect(() =>
      runScenario({
        ...example(),
        assertions: [{ kind: "robot", turn: 1, robotId: "runner", equals: { health: 140 } }],
      }),
    ).toThrow();
    expect(() =>
      runScenario({
        ...example(),
        assertions: [
          { kind: "event-count", turn: 1, where: { kind: "destroyed", robotId: "typo" }, count: 0 },
        ],
      }),
    ).toThrow("unknown robot");
    expect(() =>
      runScenario({
        ...example(),
        assertions: [{ kind: "robot", turn: 3, robotId: "runner", equals: { hp: 140 } }],
      }),
    ).toThrow("does not exist");
  });

  it("lets production order validation reject illegal movement and turn numbers", () => {
    const input = example();
    input.turns[0]!.orders.turnNumber = 2;
    expect(() => runScenario(input)).toThrow("turn-number");
    input.turns[0]!.orders.turnNumber = 1;
    input.turns[0]!.orders.timelines[0]!.segments = [
      { kind: "move", posture: "upright", path: [{ to: { x: 10, y: 1 } }] },
    ];
    expect(() => runScenario(input)).toThrow("illegal-command");
  });

  it("rejects wrong event fields instead of falsely passing an absence check", () => {
    expect(() =>
      runScenario({
        ...example(),
        assertions: [
          { kind: "event-count", turn: 1, where: { kind: "damaged", robotId: "runner" }, count: 0 },
        ],
      }),
    ).toThrow("damaged events do not have a robotId filter");
    expect(() =>
      runScenario({
        ...example(),
        assertions: [
          {
            kind: "event-count",
            turn: 1,
            where: { kind: "shot-missed", reason: "destroyed" },
            count: 0,
          },
        ],
      }),
    ).toThrow("Unsupported reason");
  });

  it("exports readable states, complete events, and a canonical replay through the CLI", () => {
    const directory = mkdtempSync(join(tmpdir(), "roboarena-scenario-"));
    try {
      const result = cli([
        "run",
        "scenarios/missile-friendly-fire.json",
        "--out",
        directory,
        "--json",
        "--seed",
        "42",
      ]);
      expect(result.status, result.stderr).toBe(0);
      expect(JSON.parse(result.stdout)).toMatchObject({ passed: true });
      expect(
        JSON.parse(readFileSync(join(directory, "events.json"), "utf8"))[0].events.length,
      ).toBeGreaterThan(0);
      expect(JSON.parse(readFileSync(join(directory, "report.json"), "utf8"))).toEqual(
        JSON.parse(result.stdout),
      );
      expect(
        verifyReplay(deserializeReplay(readFileSync(join(directory, "replay.json"), "utf8"))),
      ).toEqual({ ok: true });
      const input = example();
      input.assertions = [{ kind: "robot", turn: 1, robotId: "runner", equals: { hp: 1 } }];
      const failingFile = join(directory, "failing.json");
      writeFileSync(failingFile, JSON.stringify(input));
      const failed = cli(["run", failingFile, "--out", directory, "--json"]);
      expect(failed.status).toBe(1);
      expect(JSON.parse(failed.stdout).checks[0].passed).toBe(false);
      writeFileSync(failingFile, "{");
      expect(cli(["run", failingFile]).status).toBe(2);
      const protectedFile = join(directory, "report.json");
      writeFileSync(protectedFile, JSON.stringify(example()));
      expect(cli(["run", protectedFile, "--out", directory]).status).toBe(2);
      expect(JSON.parse(readFileSync(protectedFile, "utf8")).name).toBe(example().name);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }, 20000);

  it("provides help and rejects unknown CLI options", () => {
    expect(
      execFileSync(process.execPath, ["--import", "tsx", "src/scenario/cli.ts", "--help"], {
        encoding: "utf8",
      }),
    ).toContain("Exit codes:");
    expect(cli(["run", "scenarios/movement.json", "--sead", "42"]).status).toBe(2);
  });
});
