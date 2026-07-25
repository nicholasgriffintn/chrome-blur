import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readdir, readFile, stat } from "node:fs/promises";
import test from "node:test";

test("the production build contains the landing page and installable extension", async () => {
  const dist = new URL("../dist/", import.meta.url);
  const html = await readFile(new URL("index.html", dist), "utf8");
  const assetNames = await readdir(new URL("assets/", dist));
  const scriptNames = assetNames.filter((name) => name.endsWith(".js"));
  const scripts = await Promise.all(
    scriptNames.map((name) => readFile(new URL(`assets/${name}`, dist), "utf8")),
  );
  const archive = new URL("blur.zip", dist);
  const archiveContents = execFileSync("unzip", ["-Z1", archive.pathname], {
    encoding: "utf8",
  });

  assert.match(html, /Blur — Private content control for Chrome/);
  assert.match(html, /src="[/]assets[/]index-[^"]+[.]js"/);
  assert.ok(assetNames.some((name) => name.endsWith(".png")));
  assert.ok((await stat(archive)).size > 0);
  assert.match(scripts.join("\n"), /Local-only Chrome extension/);
  assert.match(scripts.join("\n"), /Your page never leaves the page/);
  assert.match(archiveContents, /^manifest[.]json$/m);
  assert.match(archiveContents, /^lib[/]pii-detector[.]js$/m);
  assert.doesNotMatch(archiveContents, /^website[/]/m);
});
