"use strict";

const { createCanvas, loadImage } = require("@napi-rs/canvas");

/**
 * Détection automatique de la zone circulaire prévue pour l'avatar dans une
 * image Welcome personnalisée.
 *
 * POURQUOI CE MODULE EXISTE
 * -------------------------
 * La géométrie de l'avatar (`design.avatar`) est déclarée par gabarit, en
 * coordonnées absolues. Or l'image téléversée par l'administrateur est
 * redimensionnée en « cover » : le cercle qu'il a dessiné n'a donc aucun lien
 * avec les coordonnées du gabarit, et l'avatar tombait à côté.
 *
 * PRINCIPE
 * --------
 * Une seule famille de signaux est universelle : la FRONTIÈRE CIRCULAIRE. Elle
 * couvre le disque plein, l'anneau, le trou transparent, et les cinq formats
 * acceptés. La détection combine :
 *   - support de périmètre  : part des points du cercle tombant sur un contour ;
 *   - homogénéité interne   : un emplacement d'avatar est une plage unie. C'est
 *                             LE discriminateur contre le texte — les lettres
 *                             « o » et « e » ont aussi un contour fermé à 100 %,
 *                             mais leur intérieur ne l'est pas ;
 *   - priorité de taille    : un emplacement d'avatar occupe une part notable
 *                             de la petite dimension de la carte.
 *
 * Le seuil de contour est ADAPTATIF (percentile de la carte) : un seuil absolu
 * rendait la détection aveugle à un cercle peu contrasté.
 *
 * RÈGLE DE DÉCISION — elle est volontairement CONSERVATRICE
 * ---------------------------------------------------------
 * `CONFIRME` uniquement si le meilleur candidat dépasse le seuil ET devance le
 * second d'une marge nette. Dans tous les autres cas (`AMBIGU`, `AUCUN`), le
 * module ne propose AUCUNE géométrie : l'appelant conserve celle du gabarit.
 * Un avatar légèrement décalé est acceptable ; un avatar au milieu de la carte
 * ne l'est pas. Il vaut mieux refuser que deviner.
 *
 * Ce module est PUR : aucun effet de bord, aucun accès au stockage, aucune
 * écriture. Il ne lève jamais — toute défaillance renvoie `AUCUN`.
 */

/** Verdicts de confiance. */
const AvatarCircleVerdict = Object.freeze({
  CONFIRMED: "CONFIRME",
  AMBIGUOUS: "AMBIGU",
  NONE: "AUCUN",
});

const DEFAULTS = Object.freeze({
  /** Largeur maximale de l'image de travail : 400 px donne 2-3 px de précision
   *  pour ~0,5 s. Au-delà, le coût croît sans gain mesurable. */
  maxWorkingSide: 400,
  acceptScore: 0.62,
  margin: 0.05,
});

/**
 * Réduit l'image à une taille de travail. La détection ne porte jamais sur
 * l'image pleine taille : une photo 4096×4096 coûterait aussi cher qu'une carte.
 * @returns {Promise<{data:Uint8ClampedArray,w:number,h:number,scale:number}|null>}
 */
async function toWorkingPixels(buffer, maxWorkingSide) {
  const image = await loadImage(buffer);
  const sourceWidth = Number(image.width) || 0;
  const sourceHeight = Number(image.height) || 0;
  if (sourceWidth <= 0 || sourceHeight <= 0) return null;
  const scale = Math.min(1, maxWorkingSide / Math.max(sourceWidth, sourceHeight));
  const w = Math.max(1, Math.round(sourceWidth * scale));
  const h = Math.max(1, Math.round(sourceHeight * scale));
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(image, 0, 0, w, h);
  const { data } = ctx.getImageData(0, 0, w, h);
  return { data, w, h, scale };
}

/**
 * Carte de frontière : gradient de Sobel sur la luminosité, combiné à la plus
 * forte transition d'alpha voisine. L'alpha compte parce qu'un emplacement
 * d'avatar peut être un trou transparent plutôt qu'une plage colorée.
 * Le seuil renvoyé est un percentile borné, jamais une constante.
 */
function buildBoundaryMap({ data, w, h }) {
  const gray = new Float32Array(w * h);
  const alpha = new Float32Array(w * h);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    gray[p] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    alpha[p] = data[i + 3];
  }

  const edge = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const p = y * w + x;
      const gx = gray[p - w + 1] + 2 * gray[p + 1] + gray[p + w + 1]
        - gray[p - w - 1] - 2 * gray[p - 1] - gray[p + w - 1];
      const gy = gray[p - w - 1] + 2 * gray[p - w] + gray[p - w + 1]
        - gray[p + w - 1] - 2 * gray[p + w] - gray[p + w + 1];
      const alphaDelta = Math.max(
        Math.abs(alpha[p] - alpha[p - 1]),
        Math.abs(alpha[p] - alpha[p + 1]),
        Math.abs(alpha[p] - alpha[p - w]),
        Math.abs(alpha[p] - alpha[p + w]),
      );
      edge[p] = Math.max(Math.hypot(gx, gy), alphaDelta * 0.9);
    }
  }

  const sorted = Float32Array.from(edge).sort();
  const percentile = sorted[Math.floor(sorted.length * 0.9)] || 0;
  // Borné des deux côtés : assez bas pour voir un cercle peu contrasté, assez
  // haut pour ne pas prendre le bruit d'une photo pour un contour.
  const threshold = Math.max(6, Math.min(40, percentile * 0.35));
  return { gray, edge, threshold };
}

/** Score d'un cercle candidat, ou null s'il sort du cadre. */
function scoreCandidate(cx, cy, r, maps, w, h) {
  const { gray, edge, threshold } = maps;
  if (cx - r < 0 || cy - r < 0 || cx + r >= w || cy + r >= h) return null;

  const samples = Math.max(48, Math.min(180, Math.round(r * 2)));
  let onEdge = 0;
  for (let i = 0; i < samples; i++) {
    const theta = (i / samples) * Math.PI * 2;
    const px = Math.round(cx + r * Math.cos(theta));
    const py = Math.round(cy + r * Math.sin(theta));
    let best = 0;
    // Tolérance d'1 pixel : le cercle du concepteur n'est jamais au pixel près.
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const value = edge[(py + dy) * w + (px + dx)];
        if (value > best) best = value;
      }
    }
    if (best > threshold) onEdge++;
  }
  const support = onEdge / samples;

  let insideSum = 0;
  let insideSquareSum = 0;
  let insideCount = 0;
  let outsideSum = 0;
  let outsideCount = 0;
  const step = Math.max(1, Math.round(r / 24));
  for (let y = Math.ceil(cy - r); y <= cy + r; y += step) {
    for (let x = Math.ceil(cx - r); x <= cx + r; x += step) {
      if ((x - cx) ** 2 + (y - cy) ** 2 > r * r) continue;
      const value = gray[y * w + x];
      insideSum += value;
      insideSquareSum += value * value;
      insideCount++;
    }
  }
  const outerRing = r * 1.35;
  for (let i = 0; i < 200; i++) {
    const theta = (i / 200) * Math.PI * 2;
    const x = Math.round(cx + outerRing * Math.cos(theta));
    const y = Math.round(cy + outerRing * Math.sin(theta));
    if (x < 0 || y < 0 || x >= w || y >= h) continue;
    outsideSum += gray[y * w + x];
    outsideCount++;
  }
  if (insideCount === 0 || outsideCount === 0) return null;

  const insideMean = insideSum / insideCount;
  const insideDeviation = Math.sqrt(Math.max(0, insideSquareSum / insideCount - insideMean * insideMean));
  const homogeneity = 1 / (1 + insideDeviation / 24);
  const relativeRadius = r / Math.min(w, h);
  // En dessous de 10 % de la petite dimension, ce n'est pas un emplacement
  // d'avatar mais une pastille ou une lettre.
  const sizePrior = relativeRadius < 0.1 ? 0 : relativeRadius < 0.18 ? (relativeRadius - 0.1) / 0.08 : 1;
  const contrast = Math.abs(insideMean - outsideSum / outsideCount);

  return {
    cx,
    cy,
    r,
    support,
    homogeneity,
    sizePrior,
    contrast,
    score: support * (0.45 + 0.35 * homogeneity) * (0.55 + 0.45 * sizePrior),
  };
}

/** Balayage grossier, suppression des non-maxima, puis affinage local. */
function searchCandidates(pixels) {
  const { w, h } = pixels;
  const maps = buildBoundaryMap(pixels);
  const minSide = Math.min(w, h);
  const minRadius = Math.max(6, Math.round(minSide * 0.07));
  const maxRadius = Math.round(minSide * 0.62);
  const centerStep = Math.max(3, Math.round(minSide / 60));
  const radii = [];
  const radiusStep = Math.max(2, Math.round((maxRadius - minRadius) / 22));
  for (let r = minRadius; r <= maxRadius; r += radiusStep) radii.push(r);

  const coarse = [];
  for (let cy = minRadius; cy < h - minRadius; cy += centerStep) {
    for (let cx = minRadius; cx < w - minRadius; cx += centerStep) {
      for (const r of radii) {
        const candidate = scoreCandidate(cx, cy, r, maps, w, h);
        if (candidate && candidate.support > 0.5) coarse.push(candidate);
      }
    }
  }
  coarse.sort((a, b) => b.score - a.score);

  const kept = [];
  for (const candidate of coarse) {
    const duplicate = kept.find((existing) =>
      Math.hypot(existing.cx - candidate.cx, existing.cy - candidate.cy) < Math.max(6, candidate.r * 0.35)
      && Math.abs(existing.r - candidate.r) < Math.max(5, candidate.r * 0.3));
    if (!duplicate) kept.push(candidate);
    if (kept.length >= 24) break;
  }

  const refined = [];
  for (const candidate of kept.slice(0, 10)) {
    let best = candidate;
    for (let dy = -centerStep; dy <= centerStep; dy++) {
      for (let dx = -centerStep; dx <= centerStep; dx++) {
        for (let dr = -6; dr <= 6; dr++) {
          const scored = scoreCandidate(candidate.cx + dx, candidate.cy + dy, candidate.r + dr, maps, w, h);
          if (scored && scored.score > best.score) best = scored;
        }
      }
    }
    refined.push(best);
  }
  refined.sort((a, b) => b.score - a.score);
  return refined;
}

function decide(candidates, { acceptScore, margin }) {
  const accepted = candidates.filter((candidate) => candidate.score >= acceptScore);
  if (!accepted.length) return AvatarCircleVerdict.NONE;
  if (accepted.length > 1 && accepted[0].score - accepted[1].score < margin) {
    return AvatarCircleVerdict.AMBIGUOUS;
  }
  return AvatarCircleVerdict.CONFIRMED;
}

/**
 * Détecte la zone circulaire prévue pour l'avatar.
 *
 * @param {Buffer} buffer image décodée en amont par `decodeWelcomeImage`.
 * @param {object} [options]
 * @returns {Promise<{verdict:string, geometry:{cx:number,cy:number,radius:number}|null,
 *   score:number|null, candidates:number, detail:object}>}
 *   `geometry` est exprimé en coordonnées de l'IMAGE D'ORIGINE, et vaut null
 *   dès que le verdict n'est pas `CONFIRME`.
 */
async function detectAvatarCircle(buffer, options = {}) {
  const settings = { ...DEFAULTS, ...options };
  const startedAt = Date.now();
  const empty = (verdict, extra = {}) => ({
    verdict,
    geometry: null,
    score: null,
    candidates: 0,
    detail: { durationMs: Date.now() - startedAt, ...extra },
  });

  if (!Buffer.isBuffer(buffer) || buffer.length === 0) return empty(AvatarCircleVerdict.NONE, { reason: "empty-buffer" });

  let pixels;
  let candidates;
  try {
    pixels = await toWorkingPixels(buffer, settings.maxWorkingSide);
    if (!pixels) return empty(AvatarCircleVerdict.NONE, { reason: "unreadable-dimensions" });
    candidates = searchCandidates(pixels);
  } catch (error) {
    // La détection est un confort, jamais une obligation : un échec ne doit
    // ni bloquer l'upload ni remonter comme une erreur fonctionnelle.
    options.logger?.warn?.("Welcome avatar circle detection failed", {
      guildId: options.guildId || null,
      errorType: error?.name || typeof error,
      errorMessage: error?.message || null,
    });
    return empty(AvatarCircleVerdict.NONE, { reason: "detection-error", errorType: error?.name || null });
  }

  const verdict = decide(candidates, settings);
  const best = candidates[0] || null;
  const detail = {
    durationMs: Date.now() - startedAt,
    workingWidth: pixels.w,
    workingHeight: pixels.h,
    bestScore: best ? Number(best.score.toFixed(3)) : null,
    runnerUpScore: candidates[1] ? Number(candidates[1].score.toFixed(3)) : null,
  };

  // Règle produit : seule une géométrie CONFIRMÉE est proposée. En cas
  // d'ambiguïté ou d'absence, on ne renvoie RIEN — l'appelant conserve la
  // géométrie du gabarit plutôt que de risquer un mauvais placement.
  if (verdict !== AvatarCircleVerdict.CONFIRMED || !best) {
    return { verdict, geometry: null, score: best ? Number(best.score.toFixed(3)) : null, candidates: candidates.length, detail };
  }

  const inverse = 1 / pixels.scale;
  return {
    verdict,
    geometry: {
      cx: Math.round(best.cx * inverse),
      cy: Math.round(best.cy * inverse),
      radius: Math.max(1, Math.round(best.r * inverse)),
    },
    score: Number(best.score.toFixed(3)),
    candidates: candidates.length,
    detail,
  };
}

module.exports = { detectAvatarCircle, AvatarCircleVerdict };
