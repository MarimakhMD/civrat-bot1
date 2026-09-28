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
 *
 * NOTE SUR LES PERFORMANCES
 * -------------------------
 * Le balayage grossier évalue des dizaines de milliers de cercles. Quatre
 * accélérations y sont appliquées, TOUTES à résultat bit-à-bit identique — la
 * formule de score, les seuils, la génération des candidats, la suppression des
 * non-maxima et l'affinage sont inchangés :
 *
 *  1. Le support de périmètre est calculé AVANT l'intérieur, et un candidat
 *     dont le support ne dépasse pas 0,5 est écarté immédiatement. C'est
 *     exactement le filtre déjà appliqué au balayage grossier : l'intérieur et
 *     la couronne extérieure n'étaient donc calculés que pour être jetés.
 *  2. La tolérance d'1 pixel du périmètre (max sur un voisinage 3×3) est
 *     pré-calculée une fois dans une carte dilatée : 9 lectures par
 *     échantillon deviennent 1.
 *  3. `r·cos(θ)` et `r·sin(θ)` sont tabulés par rayon. Seul le PRODUIT est
 *     tabulé, jamais son arrondi : `Math.round(cx + r·cos θ)` n'est PAS égal à
 *     `cx + Math.round(r·cos θ)` quand le produit tombe juste sous un demi
 *     (vérifié : 248 018 contre-exemples), donc l'arrondi reste fait sur la
 *     valeur complète.
 *  4. La boucle intérieure ne parcourt plus le carré englobant pour en jeter
 *     les coins : les bornes de chaque ligne sont résolues analytiquement. Les
 *     termes accumulés, et surtout leur ORDRE d'accumulation, sont identiques
 *     (vérifié sur 4 165 cas) — les sommes flottantes restent bit-à-bit égales.
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

/** Nombre d'échantillons du périmètre pour un rayon donné. */
function perimeterSamples(r) {
  return Math.max(48, Math.min(180, Math.round(r * 2)));
}

/**
 * Racine entière par excès nul. `Math.floor(Math.sqrt())` suffit sur le domaine
 * réel (vérifié jusqu'à 100 000) ; la double correction garde la fonction exacte
 * quelle que soit la précision du `sqrt` de la plateforme.
 */
function integerSqrt(value) {
  let q = Math.floor(Math.sqrt(value));
  while ((q + 1) * (q + 1) <= value) q++;
  while (q * q > value) q--;
  return q;
}

/**
 * Tables trigonométriques d'un rayon, construites à la demande pour la durée
 * d'une seule détection (aucun état partagé entre appels, aucune fuite).
 *
 * Les tableaux sont en `Float64Array` : les produits y sont stockés à la
 * précision native du calcul, la relecture est donc identique à l'expression
 * inline qu'ils remplacent.
 */
function createTrigTables(r) {
  const samples = perimeterSamples(r);
  const cos = new Float64Array(samples);
  const sin = new Float64Array(samples);
  for (let i = 0; i < samples; i++) {
    const theta = (i / samples) * Math.PI * 2;
    cos[i] = r * Math.cos(theta);
    sin[i] = r * Math.sin(theta);
  }
  const outerRadius = r * 1.35;
  const outerCos = new Float64Array(200);
  const outerSin = new Float64Array(200);
  for (let i = 0; i < 200; i++) {
    const theta = (i / 200) * Math.PI * 2;
    outerCos[i] = outerRadius * Math.cos(theta);
    outerSin[i] = outerRadius * Math.sin(theta);
  }
  return { samples, cos, sin, outerCos, outerSin };
}

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
 *
 * `dilated` porte, pour chaque position d'échantillon, le maximum de `edge` sur
 * le voisinage 3×3 — la tolérance d'1 pixel du test de périmètre, pré-calculée.
 * Le tableau est décalé de `pad` cases pour rester indexable aux positions qui
 * tombent hors image : le calcul d'index d'origine est brut (`(py+dy)*w+(px+dx)`)
 * et peut produire un index négatif ou trop grand, auquel cas la valeur lue est
 * `undefined` et le test échoue. Reproduire exactement ce comportement impose de
 * conserver la même arithmétique d'index, repli de ligne compris.
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

  const size = w * h;
  const pad = w + 1;
  const length = size + pad * 2;
  // Le maximum sur un voisinage 3×3 est séparable : maximum horizontal puis
  // maximum vertical donnent exactement le même résultat (vérifié case par
  // case), pour deux tiers de lectures en moins. Une valeur absente compte
  // pour 0, ce qui ne change rien puisque `edge` est toujours positif.
  const horizontal = new Float32Array(length);
  for (let e = 0; e < length; e++) {
    let best = 0;
    for (let dx = -1; dx <= 1; dx++) {
      const i = e - pad + dx;
      if (i < 0 || i >= size) continue;
      const value = edge[i];
      if (value > best) best = value;
    }
    horizontal[e] = best;
  }
  const dilated = new Float32Array(length);
  for (let e = 0; e < length; e++) {
    let best = 0;
    for (let dy = -1; dy <= 1; dy++) {
      const j = e + dy * w;
      if (j < 0 || j >= length) continue;
      const value = horizontal[j];
      if (value > best) best = value;
    }
    dilated[e] = best;
  }

  return { gray, edge, threshold, dilated, pad, w, h, trig: new Map() };
}

/** Tables trigonométriques du rayon, mémoïsées pour la détection en cours. */
function trigFor(maps, r) {
  let tables = maps.trig.get(r);
  if (!tables) {
    tables = createTrigTables(r);
    maps.trig.set(r, tables);
  }
  return tables;
}

/**
 * Support de périmètre d'un cercle, ou -1 s'il sort du cadre.
 * Calculé seul, il permet au balayage grossier d'écarter un candidat avant de
 * payer l'intérieur et la couronne extérieure.
 *
 * Avec `bailBelowHalf`, la boucle s'arrête dès qu'il devient ARITHMÉTIQUEMENT
 * impossible d'atteindre `support > 0,5` : il reste `samples - i` échantillons,
 * donc le meilleur support encore atteignable est `(onEdge + samples - i) /
 * samples`. S'il ne dépasse pas 0,5, le candidat sera de toute façon écarté par
 * le balayage grossier — la valeur renvoyée (-1) n'est alors jamais lue comme
 * un support. Un candidat retenu termine toujours la boucle complète et obtient
 * donc le support exact, bit-à-bit identique à la version de référence.
 * Réservé au balayage grossier : l'affinage a besoin du support de TOUS les
 * candidats et appelle cette fonction sans `bailBelowHalf`.
 */
function perimeterSupport(cx, cy, r, maps, bailBelowHalf) {
  const { dilated, pad, threshold, w, h } = maps;
  if (cx - r < 0 || cy - r < 0 || cx + r >= w || cy + r >= h) return -1;

  const tables = trigFor(maps, r);
  const { samples, cos, sin } = tables;
  let onEdge = 0;

  if (bailBelowHalf) {
    // `support > 0,5` équivaut à `onEdge >= floor(samples/2) + 1`.
    const needed = Math.floor(samples / 2) + 1;
    for (let i = 0; i < samples; i++) {
      if (onEdge + samples - i < needed) return -1;
      const px = Math.round(cx + cos[i]);
      const py = Math.round(cy + sin[i]);
      if (dilated[py * w + px + pad] > threshold) onEdge++;
    }
    return onEdge / samples;
  }

  for (let i = 0; i < samples; i++) {
    // L'arrondi porte sur la somme complète, comme dans la version de
    // référence : factoriser l'arrondi changerait le résultat.
    const px = Math.round(cx + cos[i]);
    const py = Math.round(cy + sin[i]);
    // Tolérance d'1 pixel, pré-calculée.
    if (dilated[py * w + px + pad] > threshold) onEdge++;
  }
  return onEdge / samples;
}

/**
 * Complète un candidat dont le support est déjà connu. Renvoie null si le
 * disque ou la couronne extérieure sortent du cadre.
 */
function finishCandidate(cx, cy, r, support, maps) {
  const { gray, w, h } = maps;

  let insideSum = 0;
  let insideSquareSum = 0;
  let insideCount = 0;
  const step = Math.max(1, Math.round(r / 24));
  const radiusSquared = r * r;
  for (let y = cy - r; y <= cy + r; y += step) {
    const dy = y - cy;
    const remaining = radiusSquared - dy * dy;
    if (remaining < 0) continue;
    // Demi-largeur du disque sur cette ligne. Les abscisses retenues sont
    // cx - r + k*step avec |k*step - r| <= quarter : mêmes termes, même ordre
    // d'accumulation que le balayage du carré englobant.
    const quarter = integerSqrt(remaining);
    const kFrom = (r - quarter) / step;
    const kLo = kFrom <= 0 ? 0 : Math.ceil(kFrom);
    const kHi = Math.floor((r + quarter) / step);
    if (kHi < kLo) continue;
    // L'index progresse par pas entiers et le compte est déduit du nombre de
    // termes : les deux restent des entiers exacts, la séquence de valeurs
    // lues et l'ordre des additions sont inchangés.
    let index = y * w + cx - r + kLo * step;
    const end = y * w + cx - r + kHi * step;
    insideCount += kHi - kLo + 1;
    for (; index <= end; index += step) {
      const value = gray[index];
      insideSum += value;
      insideSquareSum += value * value;
    }
  }

  let outsideSum = 0;
  let outsideCount = 0;
  const tables = trigFor(maps, r);
  const { outerCos, outerSin } = tables;
  for (let i = 0; i < 200; i++) {
    const x = Math.round(cx + outerCos[i]);
    const y = Math.round(cy + outerSin[i]);
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

/** Score d'un cercle candidat, ou null s'il sort du cadre. */
function scoreCandidate(cx, cy, r, maps) {
  const support = perimeterSupport(cx, cy, r, maps);
  if (support < 0) return null;
  return finishCandidate(cx, cy, r, support, maps);
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
        // Un candidat est retenu au balayage grossier uniquement si son support
        // dépasse 0,5 : l'évaluer avant l'intérieur évite de calculer des
        // statistiques qui seraient immédiatement jetées.
        const support = perimeterSupport(cx, cy, r, maps, true);
        if (support <= 0.5) continue;
        const candidate = finishCandidate(cx, cy, r, support, maps);
        if (candidate) coarse.push(candidate);
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
          const scored = scoreCandidate(candidate.cx + dx, candidate.cy + dy, candidate.r + dr, maps);
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
