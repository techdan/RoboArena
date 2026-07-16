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
        expect(page.getByRole("heading", { name: "Your seat is secured" })).toBeVisible(),
      ),
    );
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});
