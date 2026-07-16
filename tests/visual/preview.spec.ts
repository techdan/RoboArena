import { expect, test } from "@playwright/test";

test("renders both verified arenas without browser errors", async ({ page }) => {
  const browserErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(message.text());
  });
  page.on("pageerror", (error) => browserErrors.push(error.message));

  await page.goto("/preview");
  await expect(
    page.getByRole("heading", { name: "Original geometry. Modern battlefield." }),
  ).toBeVisible();
  await expect(page.locator('[data-pixi-arena][data-ready="true"]')).toHaveCount(2, {
    timeout: 30_000,
  });
  await expect(page.locator("canvas[data-arena-canvas]")).toHaveCount(2);
  expect(browserErrors).toEqual([]);

  await expect(page).toHaveScreenshot("arena-preview.png", {
    animations: "disabled",
    fullPage: true,
  });
});
