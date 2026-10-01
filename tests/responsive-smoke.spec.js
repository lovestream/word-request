"use strict";

const { test, expect } = require("@playwright/test");

const viewports = [
  { name: "desktop", width: 1280, height: 800 },
  { name: "mobile", width: 390, height: 844 }
];

for (const viewport of viewports) {
  test(`${viewport.name} home stays usable`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto("/");

    await expect(page).toHaveTitle(/Word Quest/);
    await expect(page.locator("#viewRoot")).toBeVisible();
    const hasHorizontalOverflow = await page.evaluate(() =>
      document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
    );
    expect(hasHorizontalOverflow).toBe(false);

    if (viewport.name === "mobile") {
      await expect(page.getByRole("navigation", { name: "移动端导航" })).toBeVisible();
      await page.getByRole("button", { name: "打开 Kevin 的设置" }).click();
      const saveButton = page.getByRole("button", { name: "保存", exact: true });
      await expect(saveButton).toBeVisible();
      const saveButtonBox = await saveButton.boundingBox();
      expect(saveButtonBox).not.toBeNull();
      expect(saveButtonBox.height).toBeGreaterThanOrEqual(44);
    }
  });
}
