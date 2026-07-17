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
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});
