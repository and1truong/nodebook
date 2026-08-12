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

  test("palette tokens map to the TabTerm-derived values in both themes", async ({ page }) => {
    await page.goto("/inbox");
    const token = (name: string) =>
      page.evaluate(
        (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(),
        name,
      );

    // Light: warm parchment surfaces, brown text, gold accent.
    expect(await token("--background")).toBe("#f5f0e8");
    expect(await token("--card")).toBe("#fffcf6");
    expect(await token("--foreground")).toBe("#1a1200");
    expect(await token("--muted-foreground")).toBe("#6b5e47");
    expect(await token("--primary")).toBe("#8b6f00");
    expect(await token("--border")).toBe("#e5ddd0");
    expect(await token("--input")).toBe("#c9bfae");
    expect(await token("--ring")).toBe("#8b6f00");
    expect(await token("--recess")).toBe("#ece5d8");
    expect(await token("--success")).toBe("#166534");
    expect(await token("--warning")).toBe("#c2410c");
    expect(await token("--danger")).toBe("#dc2626");
    expect(await token("--type-epic")).toBe("#6d28d9");
    expect(await token("--type-bug")).toBe("#c2410c");
    expect(await token("--type-incident")).toBe("#dc2626");
    expect(await token("--chip-bg")).toBe("#fff1b3");
    // The old blue palette must not come back.
    expect(await token("--primary")).not.toBe("#2f81f7");
    expect(await token("--ring")).not.toBe("#4da3ff");

    // Dark: brown background, panel-toned cards, gold accent.
    await page.evaluate(() => localStorage.setItem("nodebook-theme", "dark"));
    await page.reload();
    await expect(page.locator("html")).toHaveClass(/dark/);
    expect(await token("--background")).toBe("#1a1200");
    expect(await token("--card")).toBe("#251a00");
    expect(await token("--foreground")).toBe("#f5f0e8");
    expect(await token("--muted-foreground")).toBe("#b8ac93");
    expect(await token("--primary")).toBe("#ffd000");
    expect(await token("--border")).toBe("#3a2c0a");
    expect(await token("--input")).toBe("#5c4814");
    expect(await token("--ring")).toBe("#ffd000");
    expect(await token("--recess")).toBe("#120c00");
    expect(await token("--success")).toBe("#4ade80");
    expect(await token("--warning")).toBe("#fb923c");
    expect(await token("--danger")).toBe("#f87171");
    expect(await token("--type-epic")).toBe("#c9a4ff");
    expect(await token("--type-bug")).toBe("#fb923c");
    expect(await token("--type-incident")).toBe("#f87171");
    expect(await token("--chip-bg")).toBe("#3a2c0a");
    await page.evaluate(() => localStorage.removeItem("nodebook-theme"));
  });
});
