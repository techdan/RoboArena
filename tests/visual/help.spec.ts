import { expect, test } from "@playwright/test";

test("Field Guide exposes Robots, Terrain, and Actions on an iPad touch viewport", async ({
  browser,
}) => {
  test.setTimeout(60_000);
  // hasTouch at a faithful 1024x768 landscape viewport models iPadOS Safari,
  // which reports width=device-width rather than the phone mobile-emulation
  // layout Chromium's isMobile flag forces.
  const context = await browser.newContext({
    viewport: { width: 1024, height: 768 },
    hasTouch: true,
  });
  const page = await context.newPage();
  await page.goto("/movie/demo");
  await expect(page.getByRole("heading", { name: "After-action playback" })).toBeVisible();
  await expect(page.locator("[data-movie-ready='true']")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Field Guide" }).tap();
  const guide = page.getByRole("dialog", { name: "Field Guide" });
  await expect(guide).toBeVisible();
  await expect(guide.getByRole("tab", { name: "Robots" })).toHaveAttribute("aria-selected", "true");
  await guide.getByRole("tab", { name: "Terrain" }).tap();
  await expect(guide.getByRole("heading", { name: "Open", exact: true })).toBeVisible();
  await guide.getByRole("tab", { name: "Actions" }).tap();
  await expect(guide.getByRole("heading", { name: "Aim & Fire" })).toBeVisible();
  const movementDetails = guide.getByRole("button", { name: "Details" }).first();
  await movementDetails.tap();
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
  await expect(movementDetails).toBeFocused();
  await guide.getByRole("button", { name: "Close Field Guide" }).tap();

  const viewport = page.locator(".movie-viewport");
  const viewportBox = await viewport.boundingBox();
  expect(viewportBox).not.toBeNull();
  const centerX = Math.round((viewportBox?.x ?? 0) + (viewportBox?.width ?? 0) / 2);
  const centerY = Math.round((viewportBox?.y ?? 0) + (viewportBox?.height ?? 0) / 2);
  const session = await context.newCDPSession(page);
  await session.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [
      { x: centerX - 30, y: centerY, id: 1 },
      { x: centerX + 30, y: centerY, id: 2 },
    ],
  });
  await session.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [
      { x: centerX - 60, y: centerY, id: 1 },
      { x: centerX + 60, y: centerY, id: 2 },
    ],
  });
  await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await session.detach();
  const transform = await page.locator(".movie-canvas-content").evaluate((element) => {
    const matrix = new DOMMatrix(getComputedStyle(element).transform);
    return { scale: matrix.a, x: matrix.e, y: matrix.f };
  });
  expect(transform.scale).toBeCloseTo(2);
  expect((viewportBox!.width / 2 - transform.x) / transform.scale).toBeCloseTo(
    viewportBox!.width / 2,
  );
  expect((viewportBox!.height / 2 - transform.y) / transform.scale).toBeCloseTo(
    viewportBox!.height / 2,
  );

  const play = page.getByRole("button", { name: "Play movie" });
  const box = await play.boundingBox();
  expect(box?.width).toBeGreaterThanOrEqual(44);
  expect(box?.height).toBeGreaterThanOrEqual(44);
  await context.close();
});
