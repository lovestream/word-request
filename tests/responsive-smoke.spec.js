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

test("mobile My Words exposes the AI pack workflow", async ({ page }) => {
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.stack || error.message));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#notebook");

  await page.getByRole("button", { name: /AI 批量生成与导入/ }).click();
  expect(pageErrors).toEqual([]);
  await expect(page.getByRole("heading", { name: "让 AI 一次做好生词卡" })).toBeVisible();
  await expect(page.getByRole("button", { name: "复制完整提示词" })).toBeVisible();
  await expect(page.getByRole("link", { name: "下载空白模板" })).toHaveAttribute("href", "templates/kevin-word-pack-template.wordpack.json");
  const selectPack = page.getByRole("button", { name: "选择生词包" });
  const selectPackBox = await selectPack.boundingBox();
  expect(selectPackBox).not.toBeNull();
  expect(selectPackBox.height).toBeGreaterThanOrEqual(44);
  await page.locator("#aiWordPackFile").setInputFiles({
    name: "smoke.wordpack.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({
      format: "kevin-word-quest-ai-pack",
      version: 1,
      title: "Browser smoke pack",
      source: "Test Reader",
      trainByDefault: true,
      words: [{
        word: "whispered",
        partOfSpeech: "verb",
        ipa: "/ˈwɪspərd/",
        lemma: "whisper",
        formType: "past tense",
        definition: "spoke very quietly",
        example: "The dragon whispered a secret.",
        context: "A test reading sentence.",
        spellingChunks: ["whis", "pered"],
        memoryTip: "Picture a secret moving quietly.",
        image: {
          mimeType: "image/png",
          base64: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
          alt: "A quiet secret"
        }
      }]
    }))
  });
  await expect(page.getByRole("heading", { name: "Browser smoke pack" })).toBeVisible();
  await page.getByRole("button", { name: "确认导入 1 个词" }).click();
  await expect(page.getByRole("heading", { name: /whispered/ })).toBeVisible();
});

test("My Words bulk selection respects filters and persists training flags", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    const key = "kevin-wordquest:state:v1";
    if (localStorage.getItem(key)) return;
    const record = { schemaVersion: 2, settings: {}, stats: {}, progress: {}, customWords: {}, savedWords: {} };
    for (const [index, word] of ["apple", "banana", "cherry"].entries()) {
      const id = `custom:bulk-test-${word}`;
      record.customWords[id] = { id, word, en: `a fruit called ${word}`, example: `I ate an ${word}.`, sourceTag: "Test Reader" };
      record.savedWords[id] = { cardId: id, train: false, addedAt: 100 + index, sources: [{ sourceTag: "Test Reader", context: "Original context.", addedAt: 100 }] };
    }
    localStorage.setItem(key, JSON.stringify(record));
  });
  await page.goto("/#notebook");
  await expect(page.getByRole("button", { name: "批量加入训练候选", exact: true })).toBeDisabled();
  await page.getByRole("checkbox", { name: "选择 apple", exact: true }).check();
  await page.getByRole("checkbox", { name: "选择 banana", exact: true }).check();
  await expect(page.locator("#notebookSelectionCount")).toHaveText("已选 2 个");
  await expect(page.locator("#notebookSelectAll")).toHaveJSProperty("indeterminate", true);
  await page.getByRole("button", { name: "批量加入训练候选", exact: true }).click();
  await expect(page.locator(".notebook-summary > div").nth(1).locator("strong")).toHaveText("2");
  await page.getByRole("combobox", { name: "状态筛选" }).selectOption("saved");
  await expect(page.locator(".notebook-word-card")).toHaveCount(1);
  await page.getByRole("checkbox", { name: /全选当前结果/ }).check();
  await page.getByRole("button", { name: "批量加入训练候选", exact: true }).click();
  await page.getByRole("combobox", { name: "状态筛选" }).selectOption("all");
  await page.getByRole("checkbox", { name: /全选当前结果/ }).check();
  await page.locator("#notebookSearch").fill("apple");
  await expect(page.locator(".notebook-word-card")).toHaveCount(1);
  await expect(page.locator("#notebookSelectionCount")).toHaveText("已选 1 个");
  await page.getByRole("button", { name: "批量改为只收藏", exact: true }).click();
  await page.reload();
  await expect(page.locator(".notebook-summary > div").nth(1).locator("strong")).toHaveText("2");
  const flags = await page.evaluate(() => {
    const record = JSON.parse(localStorage.getItem("kevin-wordquest:state:v1"));
    return ["apple", "banana", "cherry"].map((word) => record.savedWords[`custom:bulk-test-${word}`].train);
  });
  expect(flags).toEqual([false, true, true]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)).toBe(false);
});
