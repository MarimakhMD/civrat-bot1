"use strict";

/**
 * Verrou d'équivalence du détecteur de cercle avatar.
 *
 * Ces tests figent le comportement du détecteur sur un jeu d'images
 * déterministe (PRNG à graine, aucune donnée aléatoire). Ils existent pour
 * rendre toute optimisation falsifiable : une refactorisation de
 * `detectAvatarCircle` doit reproduire EXACTEMENT ces verdicts, géométries,
 * scores et nombres de candidats.
 *
 * Les valeurs attendues ont été capturées sur l'implémentation de référence
 * (commit 5e97987) avant toute optimisation, puis revérifiées après.
 *
 * L'empreinte SHA-256 de chaque image est assertée en premier : si un
 * environnement ne reproduit pas l'image (police absente, codec différent),
 * le test échoue explicitement au lieu de comparer des résultats incomparables.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { createCanvas } = require("@napi-rs/canvas");

const { detectAvatarCircle, AvatarCircleVerdict } = require("../image/analysis/detectAvatarCircle");

/** PRNG déterministe (LCG). Jamais `Math.random()` : le jeu doit être reproductible. */
function lcg(seed) {
  let s = seed >>> 0;
  return () => (s = (s * 1103515245 + 12345) >>> 0) / 4294967296;
}

function drawRing(ctx, cx, cy, r, width = 12) {
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();
}

function paintBackground(ctx, W, H) {
  const gradient = ctx.createLinearGradient(0, 0, W, H);
  gradient.addColorStop(0, "#16233d");
  gradient.addColorStop(1, "#0b1020");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, W, H);
}

function buildFlat(W, H, cx, cy, r) {
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");
  paintBackground(ctx, W, H);
  ctx.fillStyle = "#e8eefc";
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  drawRing(ctx, cx, cy, r);
  return canvas.toBuffer("image/png");
}

function buildPhoto(W, H, cx, cy, r) {
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");
  paintBackground(ctx, W, H);
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.clip();
  const inner = ctx.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
  inner.addColorStop(0, "#2b6cb0");
  inner.addColorStop(0.5, "#f6ad55");
  inner.addColorStop(1, "#1a202c");
  ctx.fillStyle = inner;
  ctx.fillRect(0, 0, W, H);
  const rnd = lcg(20260921);
  for (let i = 0; i < 90; i++) {
    ctx.fillStyle = `rgba(0,0,0,${(0.1 + rnd() * 0.4).toFixed(3)})`;
    ctx.fillRect(cx - r + rnd() * 2 * r, cy - r + rnd() * 2 * r, rnd() * 70, rnd() * 70);
  }
  ctx.restore();
  drawRing(ctx, cx, cy, r);
  return canvas.toBuffer("image/png");
}

function buildLogo(W, H, cx, cy, r) {
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");
  paintBackground(ctx, W, H);
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.clip();
  ctx.fillStyle = "#f2f5fa";
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "#1b2a44";
  ctx.font = "bold 150px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("CIVRAT", cx, cy);
  ctx.restore();
  drawRing(ctx, cx, cy, r);
  return canvas.toBuffer("image/png");
}

function templateBackground(name) {
  return fs.readFileSync(path.join(__dirname, "..", "templates", name, "background.png"));
}

/**
 * Jeu de référence. `expected` provient de l'implémentation de référence
 * (commit 5e97987), mesuré avant optimisation.
 */
const REFERENCE = [
  {
    id: "plat 2172x724",
    buffer: () => buildFlat(2172, 724, 371, 304, 233),
    sha: "5b7e701838c91a61",
    expected: { verdict: "CONFIRME", geometry: { cx: 369, cy: 299, radius: 217 }, score: 0.8, runnerUp: null, candidates: 1, working: [400, 133] },
  },
  {
    id: "photo 2172x724",
    buffer: () => buildPhoto(2172, 724, 371, 304, 233),
    sha: "f8b0cf926962aa58",
    expected: { verdict: "CONFIRME", geometry: { cx: 407, cy: 212, radius: 130 }, score: 0.621, runnerUp: 0.615, candidates: 10, working: [400, 133] },
  },
  {
    id: "logo 2172x724",
    buffer: () => buildLogo(2172, 724, 371, 304, 233),
    sha: "387fb101396619fa",
    expected: { verdict: "AUCUN", geometry: null, score: 0.54, runnerUp: 0.427, candidates: 10, working: [400, 133] },
  },
  {
    id: "petit 738x270",
    buffer: () => buildFlat(738, 270, 130, 135, 100),
    sha: "8d5b11a5425a22f7",
    expected: { verdict: "CONFIRME", geometry: { cx: 129, cy: 133, radius: 92 }, score: 0.799, runnerUp: 0.401, candidates: 10, working: [400, 146] },
  },
  {
    id: "template-1",
    buffer: () => templateBackground("template-1"),
    sha: "2c5daa6aa7751dec",
    expected: { verdict: "CONFIRME", geometry: { cx: 214, cy: 149, radius: 110 }, score: 0.793, runnerUp: 0.527, candidates: 10, working: [400, 90] },
  },
  {
    id: "template-2",
    buffer: () => templateBackground("template-2"),
    sha: "fe0f2f0558ad7675",
    expected: { verdict: "CONFIRME", geometry: { cx: 218, cy: 140, radius: 107 }, score: 0.793, runnerUp: 0.551, candidates: 10, working: [400, 83] },
  },
  {
    id: "template-3",
    buffer: () => templateBackground("template-3"),
    sha: "a60523080445aa6d",
    expected: { verdict: "CONFIRME", geometry: { cx: 203, cy: 139, radius: 106 }, score: 0.792, runnerUp: 0.541, candidates: 10, working: [400, 88] },
  },
];

const sha16 = (buffer) => crypto.createHash("sha256").update(buffer).digest("hex").slice(0, 16);

test("Équivalence — les images de référence sont reproductibles", () => {
  for (const item of REFERENCE) {
    assert.equal(sha16(item.buffer()), item.sha,
      `${item.id} : l'image générée diffère de la référence — l'environnement de rendu a changé, la comparaison n'a plus de sens`);
  }
});

for (const item of REFERENCE) {
  test(`Équivalence — ${item.id} : verdict, géométrie, score et candidats identiques`, async () => {
    const buffer = item.buffer();
    assert.equal(sha16(buffer), item.sha, `${item.id} : image non reproductible`);

    const result = await detectAvatarCircle(buffer, { guildId: "1320817768962064384" });
    const { expected } = item;

    assert.equal(result.verdict, expected.verdict, `${item.id} : verdict`);
    assert.deepEqual(result.geometry, expected.geometry, `${item.id} : géométrie`);
    // Égalité STRICTE sur le score : l'optimisation doit être bit-à-bit, pas
    // « proche ». Toute dérive numérique doit être vue ici, pas en production.
    assert.equal(result.score, expected.score, `${item.id} : score`);
    assert.equal(result.detail.runnerUpScore, expected.runnerUp, `${item.id} : runner-up`);
    assert.equal(result.candidates, expected.candidates, `${item.id} : nombre de candidats`);
    assert.equal(result.detail.workingWidth, expected.working[0], `${item.id} : largeur de travail`);
    assert.equal(result.detail.workingHeight, expected.working[1], `${item.id} : hauteur de travail`);
  });
}

test("Équivalence — la détection est déterministe d'une exécution à l'autre", async () => {
  for (const item of REFERENCE) {
    const buffer = item.buffer();
    const runs = [];
    for (let i = 0; i < 3; i++) runs.push(await detectAvatarCircle(buffer, { guildId: "1320817768962064384" }));
    for (const run of runs) {
      assert.equal(run.verdict, runs[0].verdict, `${item.id} : verdict instable`);
      assert.deepEqual(run.geometry, runs[0].geometry, `${item.id} : géométrie instable`);
      assert.equal(run.score, runs[0].score, `${item.id} : score instable`);
    }
  }
});

test("Équivalence — le verdict reste cohérent avec la règle des trois états", async () => {
  for (const item of REFERENCE) {
    const result = await detectAvatarCircle(item.buffer(), {});
    if (result.verdict === AvatarCircleVerdict.CONFIRMED) {
      assert.ok(result.geometry, `${item.id} : CONFIRME doit proposer une géométrie`);
      assert.ok(result.score >= 0.62, `${item.id} : CONFIRME exige score >= acceptScore`);
    } else {
      assert.equal(result.geometry, null, `${item.id} : ${result.verdict} ne doit proposer AUCUNE géométrie`);
    }
  }
});
