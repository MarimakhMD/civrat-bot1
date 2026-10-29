"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

function atLeast(actual, minimum) {
  const a = actual.split(".").map(Number), b = minimum.split(".").map(Number);
  for (let i = 0; i < 3; i += 1) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return true;
}

function patched(name, minimum) {
  // Some packages intentionally do not export package.json. Resolve their entry
  // point, then read the enclosing manifest without bypassing runtime exports.
  const fs = require("node:fs"), path = require("node:path");
  let directory = path.dirname(require.resolve(name));
  let manifest;
  while (directory !== path.dirname(directory)) {
    const file = path.join(directory, "package.json");
    if (fs.existsSync(file)) {
      const candidate = JSON.parse(fs.readFileSync(file, "utf8"));
      if (candidate.name === name) { manifest = candidate; break; }
    }
    directory = path.dirname(directory);
  }
  assert.ok(manifest, `manifest for ${name}`);
  const actual = manifest.version;
  assert.ok(atLeast(actual, minimum), `${name} ${actual} must be >= ${minimum}`);
}

test("dependency security: corrected HTTP packages are installed", () => {
  for (const [name, version] of Object.entries({ express: "4.22.3", "body-parser": "1.20.9", "proxy-addr": "2.0.8", qs: "6.16.1" })) patched(name, version);
});

test("dependency security: qs preserves nested parsing without prototype pollution", () => {
  const qs = require("qs");
  assert.deepEqual(qs.parse("filter[role]=mod&tags[]=a&tags[]=b"), { filter: { role: "mod" }, tags: ["a", "b"] });
  const parsed = qs.parse("__proto__[civratPolluted]=yes&constructor[prototype][civratPolluted]=yes");
  assert.equal(Object.prototype.civratPolluted, undefined);
  assert.equal(Object.hasOwn(parsed, "__proto__"), false);
  assert.equal(Object.hasOwn(parsed, "constructor"), false);
});

test("dependency security: proxy trust remains explicit for IPv4 and IPv6", () => {
  const trust = require("proxy-addr").compile(["loopback"]);
  for (const address of ["127.0.0.1", "::1", "::ffff:127.0.0.1"]) assert.equal(trust(address), true);
  assert.equal(trust("203.0.113.10"), false);
});

test("dependency security: Express 4 and body-parser middleware compose without listening", () => {
  const express = require("express"), bodyParser = require("body-parser");
  const app = express();
  app.use(express.json({ limit: "16kb" }));
  app.use(bodyParser.urlencoded({ extended: true, limit: "16kb" }));
  app.get("/health", (_request, response) => response.json({ ok: true }));
  assert.ok(app._router.stack.some(layer => layer.route?.path === "/health"));
});

test("dependency security: Engine.IO rejects a session protocol mismatch without sockets", () => {
  patched("engine.io", "6.6.10");
  const { Server } = require("engine.io");
  const server = new Server();
  // A lightweight established session; no server, transport or connection is opened.
  server.clients["unit-session"] = { protocol: 4, transport: { name: "polling" } };
  const request = version => ({ _query: { sid: "unit-session", transport: "polling", EIO: version }, headers: {}, method: "GET" });
  let valid = false;
  server.verify(request("4"), false, code => { assert.equal(code, undefined); valid = true; });
  assert.equal(valid, true);
  let rejected = false;
  server.verify(request("3"), false, (code, context) => {
    assert.equal(code, Server.errors.BAD_REQUEST);
    assert.equal(context.name, "PROTOCOL_MISMATCH");
    rejected = true;
  });
  assert.equal(rejected, true);
  delete server.clients["unit-session"];
  server.close();
});

test("dependency security: Undici preserves request/response APIs without network", async () => {
  patched("undici", "6.29.1");
  const { Request, Response, Agent } = require("undici");
  const request = new Request("https://unit.invalid/", { method: "POST", body: "unit" });
  assert.equal(request.method, "POST");
  assert.equal(await request.text(), "unit");
  const response = Response.json({ ok: true });
  assert.deepEqual(await response.json(), { ok: true });
  const agent = new Agent({ connections: 1 });
  await agent.close();
});
