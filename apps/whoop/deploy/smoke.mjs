import process from "node:process";
import console from "node:console";
import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";
const base = process.env.SMOKE_URL ?? "https://whoop.3spinningplates.com";
const browser = await chromium.launch();
try {
  for (const [label, viewport] of [
    ["desktop", { width: 1440, height: 1000 }],
    ["mobile", { width: 390, height: 844 }],
  ]) {
    const page = await browser.newPage({ viewport });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(base, { waitUntil: "networkidle" });
    await page
      .getByRole("heading", { name: "Your history. More perspective." })
      .waitFor();
    assert.equal(
      await page
        .getByRole("link", { name: "Connect with WHOOP" })
        .getAttribute("href"),
      "/auth/whoop",
    );
    await page.goto(base + "/demo", { waitUntil: "networkidle" });
    const asset = await page
      .locator('script[src*="/assets/"]')
      .first()
      .getAttribute("src");
    const assetResponse = await page.request.get(base + asset);
    assert.equal(
      assetResponse.headers()["cache-control"],
      "public, max-age=31536000, immutable",
    );
    if (label === "mobile") {
      await page.keyboard.press("Tab");
      assert.equal(
        await page.evaluate(
          () => !!globalThis.document.activeElement?.closest(".sidebar"),
        ),
        false,
      );
      const toggle = page.getByRole("button", { name: "Open navigation" });
      await toggle.click();
      await expect(toggle).toHaveAttribute("aria-expanded", "true");
      await page.keyboard.press("Escape");
      await expect(toggle).toBeFocused();
    }
    await page
      .getByRole("heading", { name: "Your effort. Your rhythm." })
      .waitFor();
    const lifetime = page.getByRole("region", { name: "Lifetime statistics" });
    await expect(lifetime).toContainText("Average strain");
    const lifetimeText = await lifetime.innerText();
    await page.getByRole("button", { name: "7 days", exact: true }).click();
    await expect(lifetime).toHaveText(lifetimeText, { useInnerText: true });
    await expect(page.locator("tbody tr")).toHaveCount(7);
    await page
      .getByRole("button", { name: /^View \d/ })
      .first()
      .click();
    await page.getByRole("dialog").waitFor();
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "30 days", exact: true }).click();
    assert.equal(
      await page.evaluate(
        () =>
          globalThis.document.documentElement.scrollWidth <=
          globalThis.innerWidth,
      ),
      true,
    );
    await page.screenshot({
      path: `/tmp/gallant-live-${label}.png`,
      fullPage: true,
    });
    await expect(
      page.getByRole("heading", { name: "Your year at a glance" }),
    ).toBeVisible();
    await page.getByLabel("Calendar metric").selectOption("strain");
    const calendarDay = page
      .getByRole("button", { name: /^\d{4}-\d{2}-\d{2}: Strain/ })
      .and(page.locator(":enabled"));
    await calendarDay.first().click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "30 days", exact: true }).click();
    for (const [tab, heading] of [
      ["Sleep", "Sleep stages"],
      ["Recovery", "HRV and your baseline"],
    ]) {
      if (label === "mobile")
        await page.getByRole("button", { name: "Open navigation" }).click();
      await page.getByRole("button", { name: tab, exact: true }).click();
      await expect(
        page.getByRole("heading", { name: heading, exact: true }),
      ).toBeVisible();
      assert.equal(
        await page.evaluate(
          () =>
            globalThis.document.documentElement.scrollWidth <=
            globalThis.innerWidth,
        ),
        true,
      );
      await page.screenshot({
        path: `/tmp/gallant-live-${tab.toLowerCase()}-${label}.png`,
        fullPage: true,
        animations: "disabled",
      });
    }
    for (const [tab, region] of [
      ["Workouts", "Workout explorer"],
      ["Correlations", "Personal correlations"],
      ["Year comparisons", "Year-over-year comparisons"],
    ]) {
      if (label === "mobile")
        await page.getByRole("button", { name: "Open navigation" }).click();
      await page.getByRole("button", { name: tab, exact: true }).click();
      const panel = page.getByRole("region", { name: region });
      await expect(panel).toBeVisible();
      if (tab === "Workouts") {
        await panel
          .getByLabel("Sport", { exact: true })
          .selectOption("Running");
        await expect(panel.locator("tbody")).toContainText("Running");
        await expect(panel.locator("tbody")).not.toContainText("Cycling");
      } else if (tab === "Correlations") {
        await expect(panel).toContainText("(30 paired days)");
        await panel.getByLabel("Outcome timing").selectOption("1");
        await expect(panel).toContainText("(29 paired days)");
      } else {
        await panel.getByLabel("First year").selectOption("2024");
        await panel.getByLabel("Second year").selectOption("2023");
        await expect(panel).toContainText("365 matched calendar days");
      }
      assert.equal(
        await page.evaluate(
          () =>
            globalThis.document.documentElement.scrollWidth <=
            globalThis.innerWidth,
        ),
        true,
      );
      await panel.screenshot({
        path: `/tmp/gallant-live-${tab.replaceAll(" ", "-")}-${label}.png`,
        animations: "disabled",
      });
    }
    assert.deepEqual(errors, []);
    console.log(
      `Production ${label}: sign-in link, charts, ranges, details, yearly calendar, sleep/recovery analytics, layout, and JavaScript passed.`,
    );
    await page.close();
  }
  const context = await browser.newContext({ timezoneId: "America/Chicago" });
  const evening = await context.newPage();
  await evening.clock.setFixedTime(new Date("2026-10-17T01:00:00Z"));
  await evening.goto(base + "/demo");
  await expect(evening.getByLabel("End date")).toHaveValue("2026-10-16");
  await context.close();
  console.log(
    "Local-date boundary, immutable assets, and mobile focus checks passed.",
  );
} finally {
  await browser.close();
}
