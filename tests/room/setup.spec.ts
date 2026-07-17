import { expect, test } from "@playwright/test";

test("four browsers join, ready, and enter one authoritative match", async ({ browser }) => {
  const contexts = await Promise.all(Array.from({ length: 4 }, () => browser.newContext()));
  const pages = await Promise.all(contexts.map((context) => context.newPage()));
  try {
    await pages[0]!.goto("/");
    await pages[0]!.getByRole("button", { name: "Create private room" }).click();
    await expect(pages[0]!).toHaveURL(/\/room\/[A-HJ-NP-Z2-9]{6}$/);
    const code = pages[0]!.url().split("/").at(-1)!;

    const guests = [
      { name: "Azure Unit", color: "blue" },
      { name: "Verdant Unit", color: "green" },
      { name: "Solar Unit", color: "yellow" },
    ] as const;
    await Promise.all(
      guests.map(async (guest, index) => {
        const page = pages[index + 1]!;
        await page.goto(`/room/${code}`);
        await page.getByLabel("Team name").fill(guest.name);
        await page.getByRole("button", { name: `${guest.color} team` }).click();
        await page.getByRole("button", { name: "Join room" }).click();
        await expect(page.getByText("4 / 4 connected seats")).toBeVisible();
      }),
    );

    await expect(pages[0]!.getByText("4 / 4 connected seats")).toBeVisible();
    await Promise.all(pages.map((page) => page.getByRole("button", { name: "Ready up" }).click()));
    const start = pages[0]!.getByRole("button", { name: "Start match" });
    await expect(start).toBeEnabled();
    await start.click();
    await Promise.all(
      pages.map((page) => expect(page).toHaveURL(/\/match\/[A-Za-z0-9]{10}\/edit$/)),
    );
    expect(new Set(pages.map((page) => page.url())).size).toBe(1);
    await Promise.all(
      pages.map((page) =>
        expect(page.getByRole("heading", { name: /command board/ })).toBeVisible(),
      ),
    );
    const planner = pages[0]!;
    const board = planner.getByRole("application", { name: /planning board/ });
    await board.focus();
    await expect(planner.getByText("valid", { exact: true })).toBeVisible();
    await board.click({ position: { x: 492, y: 12 } });
    await expect(planner.getByText(/Out of home/)).toBeVisible();
    await board.click({ position: { x: 12, y: 12 } });
    await expect(planner.getByText("Deploy", { exact: true })).toBeVisible();
    await board.click({ position: { x: 36, y: 36 } });
    await expect(planner.getByText(/Blocked/)).toBeVisible();
    await board.click({ position: { x: 108, y: 12 } });
    await expect(planner.getByText("Move route", { exact: true })).toBeVisible();
    await planner.getByRole("button", { name: "ducking" }).click();
    await planner.getByRole("button", { name: "S", exact: true }).click();
    const timelines = planner.getByRole("region", { name: "Command timelines" });
    await expect(timelines.getByText("Posture", { exact: true })).toBeVisible();
    await expect(timelines.getByText("Scan heading", { exact: true })).toBeVisible();
    await planner.getByRole("button", { name: "Undo" }).click();
    await expect(timelines.getByText("Scan heading", { exact: true })).not.toBeVisible();
    await planner.getByRole("button", { name: "Redo" }).click();
    await expect(timelines.getByText("Scan heading", { exact: true })).toBeVisible();
    await timelines.getByRole("button", { name: "Edit Scan heading" }).click();
    await expect(planner.getByText("Replacing command 4", { exact: true })).toBeVisible();
    await planner.getByRole("button", { name: "N", exact: true }).click();
    await expect(planner.getByText(/Scan heading N added/)).toBeVisible();
    await timelines.getByRole("button", { name: "Delete Deploy" }).click();
    await expect(timelines.getByText("No commands", { exact: true }).first()).toBeVisible();
    await planner.getByRole("button", { name: "Undo" }).click();
    await expect(timelines.getByText("Deploy", { exact: true })).toBeVisible();

    await planner.getByRole("button", { name: "E", exact: true }).click();
    await planner.getByRole("button", { name: "Aim & Fire", exact: true }).click();
    await board.click({ position: { x: 108, y: 132 } });
    await expect(planner.getByText(/Angle blocked/)).toBeVisible();
    await planner.getByRole("button", { name: "Cancel", exact: true }).click();

    await planner.getByRole("button", { name: "Aim & Fire", exact: true }).click();
    await board.click({ position: { x: 564, y: 12 } });
    await expect(planner.getByText(/Out of range/)).toBeVisible();
    await planner.getByRole("button", { name: "Cancel", exact: true }).click();

    await planner.getByRole("button", { name: "Aim & Fire", exact: true }).click();
    await board.click({ position: { x: 204, y: 12 } });
    await expect(planner.getByText(/Hypothetical target posture estimates/)).toBeVisible();
    await planner.getByRole("button", { name: "Add Aim & Fire" }).click();
    await expect(timelines.getByText("Aim & Fire", { exact: true })).toBeVisible();

    const scanButton = planner.getByRole("button", { name: "Scan & Fire", exact: true });
    await scanButton.click();
    await expect(planner.getByLabel("Weapon")).toBeFocused();
    const maximumDistance = planner.getByLabel("Maximum Distance");
    await maximumDistance.click();
    await maximumDistance.press("Control+A");
    await maximumDistance.pressSequentially("12");
    await expect(maximumDistance).toHaveValue("12");
    await maximumDistance.press("Escape");
    await expect(scanButton).toBeFocused();

    await scanButton.click();
    await expect(planner.getByLabel("Maximum Distance")).toHaveValue("18");
    await expect(planner.getByLabel("Seconds")).toHaveValue("10");
    await planner.getByRole("button", { name: "Add Scan & Fire" }).click();
    await expect(timelines.getByText("Scan & Fire", { exact: true })).toBeVisible();

    await board.click({ position: { x: 204, y: 12 }, modifiers: ["Control", "Shift"] });
    await expect(planner.getByRole("checkbox")).toBeChecked();
    await planner.getByRole("button", { name: "Add Aim & Fire" }).click();
    await expect(timelines.getByText("Aim & Fire", { exact: true })).toHaveCount(2);
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});
