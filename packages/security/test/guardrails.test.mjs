import test from "node:test";
import assert from "node:assert/strict";
import {
  PHASE0_PROHIBITED_CAPABILITIES,
  PHASE0_ALLOWED_PURPOSES,
  assertNoExternalSideEffect,
  assertPhaseZeroParticipantBoundary,
  assertPhaseZeroNoCollaboration,
  validatePhaseZeroConsent,
  normalizePhaseZeroDecision,
} from "../src/guardrails.mjs";

test("private core denies external collaboration and monetization actions", () => {
  for (const action of PHASE0_PROHIBITED_CAPABILITIES) {
    assert.throws(() => assertNoExternalSideEffect(action), /Phase 0 denied/);
  }
  assert.doesNotThrow(() => assertNoExternalSideEffect("owner_review"));
});

test("principal and owner must match for private access", () => {
  assert.throws(() => assertPhaseZeroParticipantBoundary({ principalId: "alice", ownerId: "bob" }), /principal must match owner/);
  assert.doesNotThrow(() => assertPhaseZeroParticipantBoundary({ principalId: "alice", ownerId: "alice" }));
});

test("consent is fail-closed for purpose, expiry, destination, and revocation", () => {
  const now = Date.now();
  assert.doesNotThrow(() => validatePhaseZeroConsent({
    principalId: "alice",
    ownerId: "alice",
    action: "owner_review",
    purpose: "private_recovery",
    resourceId: "room-42",
    destination: "private-room",
    expiresAt: now + 60_000,
    revoked: false,
    createdAt: now - 30_000,
  }));

  assert.throws(() => validatePhaseZeroConsent({
    principalId: "alice",
    ownerId: "alice",
    action: "owner_review",
    purpose: "public_share",
    resourceId: "room-42",
    destination: "private-room",
    expiresAt: now + 60_000,
    revoked: false,
    createdAt: now - 30_000,
  }), /not allowed/);

  assert.throws(() => validatePhaseZeroConsent({
    principalId: "alice",
    ownerId: "alice",
    action: "owner_review",
    purpose: "owner_review",
    resourceId: "room-42",
    destination: "public-room",
    expiresAt: now + 60_000,
    revoked: false,
    createdAt: now - 30_000,
  }), /destination/);

  assert.throws(() => validatePhaseZeroConsent({
    principalId: "alice",
    ownerId: "alice",
    action: "owner_review",
    purpose: "owner_review",
    resourceId: "room-42",
    destination: "private-room",
    expiresAt: now - 1,
    revoked: false,
    createdAt: now - 30_000,
  }), /unexpired/);
});

test("collaboration and external delivery remain disabled in Phase 0", () => {
  assert.doesNotThrow(() => assertPhaseZeroNoCollaboration({ shareState: false, inviteState: false, externalDeliveryState: false }));
  assert.throws(() => assertPhaseZeroNoCollaboration({ shareState: true, inviteState: false, externalDeliveryState: false }), /collaboration/);
});

test("normalized decision preserves deny-by-default semantics", () => {
  const result = normalizePhaseZeroDecision({ allowed: false });
  assert.equal(result.allowed, false);
  assert.match(result.reason, /deny-by-default/);
  assert.deepEqual(normalizePhaseZeroDecision({ allowed: true, reason: "explicit" }), { allowed: true, reason: "explicit" });
});

assert.ok(Array.isArray(PHASE0_ALLOWED_PURPOSES));
