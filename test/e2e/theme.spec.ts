/**
 * Theme switching: system default on first visit, manual light/dark override
 * with localStorage persistence, and live following of OS preference in
 * system mode. The bootstrap script in index.html applies the theme before
 * first paint, so the <html> class is correct immediately after navigation.
 */
import { expect, test } from "@playwright/test";

test.describe.serial("Theme switching", () => {
  test("defaults to system (dark) and persists a light override across reloads", async ({ page }) => {
    // OS prefers dark and no stored preference: the app must boot in dark.
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto("/inbox");
    await expect(page.locator("html")).toHaveClass(/dark/);

    // Switch to Light via the topbar theme menu.
    await page.getByLabel("Theme").click();
    await page.getByRole("menuitem", { name: "Light" }).click();
    await expect(page.locator("html")).not.toHaveClass(/dark/);
    expect(await page.evaluate(() => localStorage.getItem("nodebook-theme"))).toBe("light");

    // Reload: the stored preference wins (and the bootstrap script means
    // there is no flash of the wrong theme).
    await page.reload();
    await expect(page.locator("html")).not.toHaveClass(/dark/);
    await expect(page.getByRole("heading", { name: "Inbox" })).toBeVisible();
  });

  test("system mode follows OS preference changes live", async ({ page }) => {
    await page.goto("/inbox");

    // Switch to System explicitly.
    await page.getByLabel("Theme").click();
    await page.getByRole("menuitem", { name: "System" }).click();
    expect(await page.evaluate(() => localStorage.getItem("nodebook-theme"))).toBe("system");

    // The <html> class tracks prefers-color-scheme without a reload.
    await page.emulateMedia({ colorScheme: "dark" });
    await expect(page.locator("html")).toHaveClass(/dark/);
    await page.emulateMedia({ colorScheme: "light" });
    await expect(page.locator("html")).not.toHaveClass(/dark/);
  });
});
