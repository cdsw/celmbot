import { expect, test } from "@playwright/test";

test("api health", async ({ request }) => {
  const res = await request.get("/api/health");
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  expect(body.name).toBe("celmbot");
  expect(body.installRoot).toBeTruthy();
  expect(body.dataDir).toBeTruthy();
});

test("serves spa shell with brand", async ({ request }) => {
  const res = await request.get("/");
  expect(res.ok()).toBeTruthy();
  const html = await res.text();
  expect(html).toContain("CelmBot");
  expect(html).toContain('id="root"');
  expect(html).toMatch(/\/assets\/index-.*\.js/);
});

test("catalogs and recipes endpoints", async ({ request }) => {
  const catalogs = await (await request.get("/api/catalogs")).json();
  expect(catalogs.cloud.length).toBeGreaterThan(0);
  expect(catalogs.local.some((x: { id: string }) => x.id === "omfm")).toBeTruthy();
  const recipes = await (await request.get("/api/recipes")).json();
  expect(recipes.some((r: { name: string }) => r.name === "npm_test")).toBeTruthy();
});

test("fs list requires projectRoot", async ({ request }) => {
  const res = await request.get("/api/fs/list");
  expect(res.status()).toBe(400);
});
