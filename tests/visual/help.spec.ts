import { expect, test } from "@playwright/test";

test("Field Guide exposes Robots, Terrain, and Actions on an iPad touch viewport", async ({
  browser,
}) => {
  test.setTimeout(60_000);
  const context = await browser.newContext({
    viewport: { width: 1024, height: 768 },
    hasTouch: true,
    isMobile: true,
  });
  const page = await context.newPage();
  await page.goto("/movie/demo");
  await expect(page.getByRole("heading", { name: "After-action playback" })).toBeVisible();
  await expect(page.locator("[data-movie-ready='true']")).toBeVisible({ timeout: 30_000 });
  await page.keyboard.press("h");
  const guide = page.getByRole("dialog", { name: "Field Guide" });
  await expect(guide).toBeVisible();
  await expect(guide.getByRole("tab", { name: "Robots" })).toHaveAttribute("aria-selected", "true");
  await guide.getByRole("tab", { name: "Terrain" }).click();
  await expect(guide.getByRole("heading", { name: "Open", exact: true })).toBeVisible();
  await guide.getByRole("tab", { name: "Actions" }).click();
  await expect(guide.getByRole("heading", { name: "Aim & Fire" })).toBeVisible();
  await guide.getByRole("button", { name: "Details" }).first().click();
  const details = page.getByRole("dialog", { name: "Movement" });
  await expect(details).toBeVisible();
  await expect(details.getByText("30 ticks · 0.50s")).toBeVisible();
  const close = details.getByRole("button", { name: "Close Movement details" });
  const closeBox = await close.boundingBox();
  expect(closeBox).not.toBeNull();
  await page.touchscreen.tap(
    (closeBox?.x ?? 0) + (closeBox?.width ?? 0) / 2,
    (closeBox?.y ?? 0) + (closeBox?.height ?? 0) / 2,
  );
  await expect(details).toBeHidden();
  const play = page.getByRole("button", { name: "Play movie" });
  const box = await play.boundingBox();
  expect(box?.height).toBeGreaterThanOrEqual(44);
  await context.close();
});
