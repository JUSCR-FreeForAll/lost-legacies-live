# Phase 0 private-core safety status

This document records the current safety boundary; it is not a security certification.

## Current implementation boundary

The repository currently contains a dashboard scaffold and deterministic Time Engine package. It does **not** contain an authenticated Secret Room service, production identity provider, sensitive-content persistence, encryption-key lifecycle, or PostgreSQL integration harness. Therefore sensitive participant content, collaboration, invitations, sharing, external delivery, and discovery must remain disabled. The dashboard's example counts and timeline are illustrative UI data only and must not be interpreted as live repository or participant telemetry.

## Required before enabling any sensitive persistence

- Establish and review the authenticated-principal boundary; never trust a participant identifier supplied by a client.
- Define resource ownership and enforce it in application policy and database constraints.
- Verify encryption and key lifecycle before sensitive storage becomes available.
- Keep sharing, invitation, publication, discovery, network delivery, payments, ranking, and external side effects unavailable in Phase 0.
- Bind consent and idempotency checks to principal, purpose, resource, audience/destination, expiry, revocation, and operation type.
- Test ownership isolation, revocation races, retries, and constraints against disposable real PostgreSQL, not mocks alone.

## Acceptance evidence

Track the 12 criteria in [issue #2](https://github.com/JUSCR-FreeForAll/lost-legacies-live/issues/2). Each must link to an actual test and recorded pass/fail/skip result. No checkbox or status should be marked complete based on this document alone. Do not close the gate, merge to the default branch, migrate participant data, or deploy a sensitive flow until reviewers approve implementation and evidence.

## Rollback

The current app is a static scaffold and has no participant-data migration. Revert the relevant code commit to roll back the UI changes. Any future database change must provide a forward-only corrective migration and a tested rollback/recovery plan using disposable environments; never delete incompatible participant rows automatically.
