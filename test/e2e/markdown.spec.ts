import { expect, test, type APIRequestContext } from "@playwright/test";

const markdown = `# Heading one

## Heading two

### Heading three

#### Heading four

##### Heading five

###### Heading six

Paragraph with **strong text**, ~~deleted text~~, \`inline code\`, and a [link](/inbox).

- Unordered
  1. Nested ordered
     - Nested unordered
- [x] Finished task
- [ ] Open task

> A blockquote with a verylongurl.example.com/${"segment/".repeat(20)}

---

\`\`\`text
const veryLongLine = "${"code".repeat(60)}";
\`\`\`

![NodeBook image](/markdown-fixture.png)

| First very wide column | Second very wide column | Third very wide column | Fourth very wide column |
| --- | --- | --- | --- |
| ${"wide content ".repeat(8)} | Cell two | Cell three | Cell four |
`;

async function post(request: APIRequestContext, path: string, data: unknown) {
  const response = await request.post(path, { data });
  expect(response.ok()).toBeTruthy();
  return response.json() as Promise<{ number: number }>;
}

test("rich Markdown is responsive and shared by bodies, comments, and previews", async ({ page, request }) => {
  const issue = await post(request, "/api/issues", { title: "Markdown prose fixture", body: markdown, type: "task" });
  await post(request, `/api/issues/${issue.number}/comments`, { body: markdown });

  await page.route("**/markdown-fixture.png", (route) =>
    route.fulfill({
      contentType: "image/png",
      // A valid 1 × 1 transparent PNG keeps the test self-contained.
      body: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
        "base64",
      ),
    }),
  );

  for (const fixture of [
    { width: 1280, height: 900, theme: "light" },
    { width: 390, height: 844, theme: "dark" },
  ] as const) {
    await page.setViewportSize({ width: fixture.width, height: fixture.height });
    // Set the preference from a same-origin page rather than accumulating
    // init scripts across iterations (which makes the winning theme unclear).
    await page.goto("/inbox");
    await page.evaluate((theme) => localStorage.setItem("nodebook-theme", theme), fixture.theme);
    await page.goto(`/issues/${issue.number}`);
    await expect(page.locator("html")).toHaveClass(fixture.theme === "dark" ? /dark/ : /^(?!.*dark)/);

    const body = page.locator(".issue-body");
    await expect(body.getByRole("heading", { level: 1, name: "Heading one" })).toBeVisible();
    for (const [level, name] of [
      [2, "Heading two"],
      [3, "Heading three"],
      [4, "Heading four"],
      [5, "Heading five"],
      [6, "Heading six"],
    ] as const) {
      await expect(body.getByRole("heading", { level, name })).toBeVisible();
    }
    await expect(body.locator("ul").first()).toHaveCSS("list-style-type", "disc");
    await expect(body.locator("ol").first()).toHaveCSS("list-style-type", "decimal");
    await expect(body.locator(".task-list-item")).toHaveCount(2);
    await expect(body.locator("blockquote")).toBeVisible();
    await expect(body.locator("code", { hasText: "inline code" })).toBeVisible();
    await expect(body.locator("pre code")).toContainText("veryLongLine");
    await expect(body.getByRole("link", { name: "link" })).toBeVisible();
    const image = body.getByRole("img", { name: "NodeBook image" });
    await expect(image).toBeVisible();
    await expect(image).toHaveCSS("max-width", "100%");
    await expect(image).toHaveCSS("height", "1px");

    const tableWrap = body.locator(".markdown-table-wrap");
    await expect(tableWrap).toHaveAttribute("tabindex", "0");
    await expect(tableWrap).toHaveCSS("overflow-x", "auto");
    expect(await body.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBeTruthy();
    expect(await tableWrap.evaluate((element) => element.scrollWidth >= element.clientWidth)).toBeTruthy();

    const foreground = await page.evaluate(() => getComputedStyle(document.body).color);
    await expect(body).toHaveCSS("color", foreground);
    const comment = page.locator(".comment .markdown");
    await expect(comment.getByRole("heading", { level: 1, name: "Heading one" })).toBeVisible();
    await expect(comment.locator(".markdown-table-wrap")).toBeVisible();
  }

  await page.getByRole("button", { name: "Edit", exact: true }).first().click();
  await page.getByRole("button", { name: "Preview", exact: true }).click();
  const preview = page.locator(".issue-editor-inline .markdown");
  await expect(preview.getByRole("heading", { level: 1, name: "Heading one" })).toBeVisible();
  await expect(preview.locator(".markdown-table-wrap")).toBeVisible();
});
