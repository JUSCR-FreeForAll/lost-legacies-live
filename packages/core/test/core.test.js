import test from "node:test";
import assert from "node:assert/strict";
import { createProjectReference, portfolioPrinciples } from "../src/index.js";

test("portfolio principles are stable and uniquely identified", () => {
  assert.equal(portfolioPrinciples.length, 4);
  assert.equal(new Set(portfolioPrinciples.map(({ id }) => id)).size, 4);
});

test("project references validate and normalize project IDs", () => {
  const reference = createProjectReference({
    projectId: " time-engine ",
    repositoryUrl: "https://github.com/example/time-engine"
  });
  assert.equal(reference.projectId, "time-engine");
  assert.equal(reference.status, "unverified");
});

test("project references reject non-HTTPS URLs", () => {
  assert.throws(() => createProjectReference({
    projectId: "time-engine",
    repositoryUrl: "http://example.com"
  }), /HTTPS URL/);
});
