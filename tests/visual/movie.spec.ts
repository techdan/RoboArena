import { expect, test } from "@playwright/test";

test("movie transport controls select deterministic snapshots", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto("/movie/demo");
  await expect(page.getByRole("heading", { name: "After-action playback" })).toBeVisible();
  await expect(
    page.locator("[data-movie-ready='true'] canvas[data-movie-canvas='true']"),
  ).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Step forward" }).click();
  await expect(page.locator("[data-movie-tick]")).toHaveText("TICK 020");
  await page.getByRole("button", { name: "Step backward" }).click();
  await expect(page.locator("[data-movie-tick]")).toHaveText("TICK 000");
  await page.getByRole("button", { name: "4x" }).click();
  await expect(page.getByRole("button", { name: "4x" })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Play movie" }).click();
  await expect(page.locator("[data-movie-tick]")).toHaveText("TICK 020", { timeout: 2_000 });
  await page.getByRole("button", { name: "Pause movie" }).click();
  const pausedTick = await page.locator("[data-movie-tick]").textContent();
  await page.waitForTimeout(400);
  await expect(page.locator("[data-movie-tick]")).toHaveText(pausedTick ?? "");
  await page.getByLabel("Skip idle").uncheck();
  await expect(page.getByLabel("Skip idle")).not.toBeChecked();
  await page.getByLabel("Skip idle").check();
  await page.locator("input[type='range']").fill("11");
  await expect(page.locator("[data-movie-tick]")).toHaveText("TICK 205");
  await expect(page.locator("[data-animation-cues]")).toHaveAttribute(
    "data-animation-cues",
    "impact hit destroyed",
  );
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(page).toHaveScreenshot("movie-player.png", {
    animations: "disabled",
    fullPage: true,
  });
  expect(errors).toEqual([]);
});
