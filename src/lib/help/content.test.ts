import { describe, expect, it } from "vitest";
import { ROBOT_DEFINITIONS, WEAPONS } from "../../engine/catalog.js";
import { ACTION_HELP, HELP_TOPICS, ROBOT_HELP, helpTopic } from "./content.js";

describe("Phase 11.5 help content", () => {
  it("exposes every shipped non-Stealth class and omits Stealth", () => {
    expect(ROBOT_HELP.map((topic) => topic.id)).toEqual([
      "robot:rifle",
      "robot:burst",
      "robot:auto",
      "robot:missile",
    ]);
    expect(HELP_TOPICS.map((topic) => String(topic.id))).not.toContain("robot:stealth");
  });

  it("derives robot and weapon facts from canonical catalogs", () => {
    const rifle = helpTopic("robot:rifle");
    expect(rifle.facts).toContainEqual({
      label: "Armor",
      value: `${ROBOT_DEFINITIONS.rifle.armor} HP`,
    });
    expect(rifle.facts.find((fact) => fact.label === "Weapons")?.value).toContain(
      WEAPONS.rifle.displayName,
    );
  });

  it("derives movement timing from engine constants", () => {
    const movement = ACTION_HELP.find((topic) => topic.id === "action:movement");
    expect(movement?.facts).toContainEqual({
      label: "One tile",
      value: "0.50s",
    });
  });
});
