import { expect, test, type Locator, type Page } from "@playwright/test";

// iPadOS Safari in landscape honors width=device-width and does not apply the
// phone mobile-emulation layout that Chromium's isMobile flag forces. Emulating
// touch with hasTouch at a faithful 1024x768 viewport avoids the scaled visual
// viewport whose translated tap coordinates land on parent sections near the
// fold; a real iPad maps touches to CSS pixels 1:1.
const touchContext = {
  viewport: { width: 1024, height: 768 },
  hasTouch: true,
} as const;

const longPress = async (
  page: Page,
  locator: Locator,
  position: { readonly x: number; readonly y: number },
) => {
  const bounds = await locator.boundingBox();
  if (bounds === null) throw new Error("Cannot long-press a hidden arena.");
  const x = Math.round(bounds.x + position.x);
  const y = Math.round(bounds.y + position.y);
  const session = await page.context().newCDPSession(page);
  try {
    await session.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x, y, id: 1, radiusX: 4, radiusY: 4 }],
    });
    await page.waitForTimeout(600);
    await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  } finally {
    await session.detach();
  }
};

test("four touch browsers complete an authoritative planned turn and reconnect", async ({
  browser,
}) => {
  const contexts = await Promise.all(
    Array.from({ length: 4 }, () => browser.newContext(touchContext)),
  );
  const pages = await Promise.all(contexts.map((context) => context.newPage()));
  try {
    await pages[0]!.goto("/");
    await pages[0]!.getByRole("button", { name: "Create private room" }).tap();
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
        await page.getByRole("button", { name: `${guest.color} team` }).tap();
        await page.getByRole("button", { name: "Join room" }).tap();
        await expect(page.getByText("4 / 4 connected seats")).toBeVisible();
      }),
    );

    await expect(pages[0]!.getByText("4 / 4 connected seats")).toBeVisible();
    await Promise.all(pages.map((page) => page.getByRole("button", { name: "Ready up" }).tap()));
    const start = pages[0]!.getByRole("button", { name: "Start match" });
    await expect(start).toBeEnabled();
    await start.tap();
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
    await planner.getByRole("button", { name: "Field Guide" }).tap();
    const guide = planner.getByRole("dialog", { name: "Field Guide" });
    await expect(guide).toBeVisible();
    await guide.getByRole("tab", { name: "Actions" }).tap();
    await expect(guide.getByRole("heading", { name: "Movement", exact: true })).toBeVisible();
    await guide.getByRole("button", { name: "Close Field Guide" }).tap();
    const board = planner.getByRole("application", { name: /planning board/ });
    await longPress(planner, board, { x: 12, y: 12 });
    await expect(planner.locator(".info-popover")).toBeVisible();
    await planner
      .locator(".info-popover")
      .getByRole("button", { name: /Close .* details/ })
      .tap();
    await board.tap({ position: { x: 492, y: 12 } });
    await expect(planner.getByText(/Out of home/)).toBeVisible();
    await board.tap({ position: { x: 12, y: 12 } });
    await expect(planner.getByText("Deploy", { exact: true })).toBeVisible();
    await board.tap({ position: { x: 36, y: 36 } });
    await expect(planner.getByText(/Blocked/)).toBeVisible();
    await board.tap({ position: { x: 108, y: 12 } });
    await expect(planner.getByText("Move route", { exact: true })).toBeVisible();
    await planner.getByRole("button", { name: "ducking" }).tap();
    await planner.getByRole("button", { name: "S", exact: true }).tap();
    const timelines = planner.getByRole("region", { name: "Command timelines" });
    await expect(timelines.getByText("Posture", { exact: true })).toBeVisible();
    await expect(timelines.getByText("Scan heading", { exact: true })).toBeVisible();
    await planner.getByRole("button", { name: "Undo" }).tap();
    await expect(timelines.getByText("Scan heading", { exact: true })).not.toBeVisible();
    await planner.getByRole("button", { name: "Redo" }).tap();
    await expect(timelines.getByText("Scan heading", { exact: true })).toBeVisible();
    await timelines.getByRole("button", { name: "Edit Scan heading" }).tap();
    await expect(planner.getByText("Replacing command 4", { exact: true })).toBeVisible();
    await planner.getByRole("button", { name: "N", exact: true }).tap();
    await expect(planner.getByText(/Scan heading N added/)).toBeVisible();
    await timelines.getByRole("button", { name: "Delete Deploy" }).tap();
    await expect(timelines.getByText("No commands", { exact: true }).first()).toBeVisible();
    await planner.getByRole("button", { name: "Undo" }).tap();
    await expect(timelines.getByText("Deploy", { exact: true })).toBeVisible();

    await planner.getByRole("button", { name: "E", exact: true }).tap();
    await planner.getByRole("button", { name: "Aim & Fire", exact: true }).tap();
    await board.tap({ position: { x: 108, y: 132 } });
    await expect(planner.getByText(/Angle blocked/)).toBeVisible();
    await planner.getByRole("button", { name: "Cancel", exact: true }).tap();

    await planner.getByRole("button", { name: "Aim & Fire", exact: true }).tap();
    await board.tap({ position: { x: 564, y: 12 } });
    await expect(planner.getByText(/Out of range/)).toBeVisible();
    await planner.getByRole("button", { name: "Cancel", exact: true }).tap();

    await planner.getByRole("button", { name: "Aim & Fire", exact: true }).tap();
    await board.tap({ position: { x: 204, y: 12 } });
    await expect(planner.getByText(/Hypothetical target posture estimates/)).toBeVisible();
    await planner.getByRole("button", { name: "Add Aim & Fire" }).tap();
    await expect(timelines.getByText("Aim & Fire", { exact: true })).toBeVisible();

    const scanButton = planner.getByRole("button", { name: "Scan & Fire", exact: true });
    await scanButton.tap();
    const maximumDistance = planner.getByLabel("Maximum Distance");
    await maximumDistance.fill("12");
    await expect(maximumDistance).toHaveValue("12");
    await planner.getByRole("button", { name: "Close Scan and Fire dialog" }).tap();

    await scanButton.tap();
    await expect(planner.getByLabel("Maximum Distance")).toHaveValue("18");
    await expect(planner.getByLabel("Seconds")).toHaveValue("10");
    await planner.getByRole("button", { name: "Add Scan & Fire" }).tap();
    await expect(timelines.getByText("Scan & Fire", { exact: true })).toBeVisible();

    await planner.getByRole("button", { name: "Aim & Fire", exact: true }).tap();
    await board.tap({ position: { x: 204, y: 12 } });
    await planner.locator(".repeat-choice").tap();
    await expect(planner.getByRole("checkbox")).toBeChecked();
    await planner.getByRole("button", { name: "Add Aim & Fire" }).tap();
    await expect(timelines.getByText("Aim & Fire", { exact: true })).toHaveCount(2);

    await Promise.all(
      pages.map((page) => page.getByRole("button", { name: "Lock orders", exact: true }).tap()),
    );
    await Promise.all(
      pages.map((page) =>
        expect(page.getByText("Turn ready", { exact: true })).toBeVisible({ timeout: 15_000 }),
      ),
    );
    await expect(
      pages[0]!.getByRole("button", { name: "Acknowledge Turn 1 and plan next" }),
    ).toBeVisible();
    await planner.reload();
    await expect(
      planner.getByRole("button", { name: "Acknowledge Turn 1 and plan next" }),
    ).toBeVisible();
    await expect(planner.locator("[data-movie-ready='true']")).toBeVisible({ timeout: 30_000 });
    await planner.getByRole("button", { name: "Step forward" }).tap();
    await planner.getByRole("button", { name: "Play movie" }).tap();
    await expect(planner.getByRole("button", { name: "Pause movie" })).toBeVisible();
    await planner.getByRole("button", { name: "Pause movie" }).tap();
    await pages[0]!.getByRole("button", { name: "Acknowledge Turn 1 and plan next" }).tap();
    await expect(pages[0]!.getByRole("heading", { name: /command board/ })).toBeVisible();
    await expect(pages[0]!.getByText("Turn 2 · Private draft")).toBeVisible();
    await expect(
      pages[1]!.getByRole("button", { name: "Acknowledge Turn 1 and plan next" }),
    ).toBeVisible();
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});
