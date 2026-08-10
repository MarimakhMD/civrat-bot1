"use strict";

function exact(value) {
  return Object.freeze({ type: "exact", value });
}

function prefix(value) {
  return Object.freeze({ type: "prefix", value });
}

function matches(matcher, value) {
  return matcher.type === "exact" ? matcher.value === value : value.startsWith(matcher.value);
}

function overlaps(left, right) {
  if (left.type === "exact" && right.type === "exact") return left.value === right.value;
  if (left.type === "exact") return left.value.startsWith(right.value);
  if (right.type === "exact") return right.value.startsWith(left.value);
  return left.value.startsWith(right.value) || right.value.startsWith(left.value);
}

function validateMatcher(matcher) {
  if (!matcher || !["exact", "prefix"].includes(matcher.type) || typeof matcher.value !== "string" || !matcher.value) {
    throw new TypeError("A route matcher requires a non-empty exact or prefix value.");
  }
}

module.exports = { exact, prefix, matches, overlaps, validateMatcher };
