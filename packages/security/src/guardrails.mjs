export const PHASE0_PROHIBITED_CAPABILITIES = Object.freeze([
  "share",
  "invite",
  "publish",
  "transfer",
  "mint",
  "wallet",
  "payment",
  "auction",
  "external_delivery",
  "public_discovery",
]);

export const PHASE0_ALLOWED_PURPOSES = Object.freeze([
  "owner_review",
  "private_recovery",
  "private_consultation",
]);

export function assertNoExternalSideEffect(action) {
  if (!action || typeof action !== "string") {
    throw new TypeError("action must be a non-empty string");
  }

  if (PHASE0_PROHIBITED_CAPABILITIES.includes(action)) {
    throw new Error(`Phase 0 denied: ${action} is not allowed in the private core safety gate`);
  }
}

export function assertPhaseZeroParticipantBoundary({ principalId, ownerId }) {
  if (typeof principalId !== "string" || !principalId.trim()) {
    throw new TypeError("principalId is required");
  }

  if (typeof ownerId !== "string" || !ownerId.trim()) {
    throw new TypeError("ownerId is required");
  }

  if (principalId !== ownerId) {
    throw new Error("Phase 0 denied: principal must match owner for private secret-room access");
  }
}

export function validatePhaseZeroConsent({
  principalId,
  ownerId,
  action,
  purpose,
  resourceId,
  destination,
  expiresAt,
  revoked,
  createdAt,
}) {
  assertNoExternalSideEffect(action);
  assertPhaseZeroParticipantBoundary({ principalId, ownerId });

  if (typeof purpose !== "string" || !PHASE0_ALLOWED_PURPOSES.includes(purpose)) {
    throw new Error(`Phase 0 denied: purpose ${String(purpose)} is not allowed`);
  }

  if (typeof resourceId !== "string" || !resourceId.trim()) {
    throw new TypeError("resourceId is required");
  }

  if (destination && typeof destination !== "string") {
    throw new TypeError("destination must be a string or null");
  }

  if (destination && destination !== "private-room") {
    throw new Error("Phase 0 denied: destination can only be a private-room or null");
  }

  if (!expiresAt || Number(expiresAt) <= Date.now()) {
    throw new Error("Phase 0 denied: consent must be unexpired");
  }

  if (revoked === true) {
    throw new Error("Phase 0 denied: consent was revoked");
  }

  if (createdAt && Number(createdAt) > Number(expiresAt)) {
    throw new Error("Phase 0 denied: consent cannot be created after expiration");
  }

  return true;
}

export function assertPhaseZeroNoCollaboration({ shareState, inviteState, externalDeliveryState }) {
  if (shareState === true || inviteState === true || externalDeliveryState === true) {
    throw new Error("Phase 0 denied: collaboration or external delivery is not allowed");
  }
}

export function normalizePhaseZeroDecision(input) {
  const decision = {
    allowed: true,
    reason: null,
    ...input,
  };

  if (decision.allowed === false && !decision.reason) {
    decision.reason = "Phase 0 deny-by-default policy";
  }

  return decision;
}
