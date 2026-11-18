# Identity and interoperability contracts — proposal

**Status:** Design proposal; not implemented  
**Version:** 0.1.0-draft  
**Purpose:** Establish shared vocabulary without assuming a single identity provider, database, or product runtime.

## 1. Design principles

- Each product remains independently operable.
- Authentication proves control of an identity at an issuer; authorization decides access to a specific resource.
- A user identifier from one product is not automatically a global identity.
- Cross-product linking requires explicit, purpose-specific consent.
- Project and tenant ownership must be explicit on every shared resource.
- Do not place sensitive personal data, private legacy content, or secrets in identifiers, event metadata, or logs.
- A speaker label, writing style, parenthesis convention, or relayed message is not authentication or proof of consent.
- Contracts are versioned and backward compatibility is tested.

## 2. Proposed identifiers

| Field | Meaning | Rule |
|---|---|---|
| `project_id` | Stable identifier for a product/repository boundary | Required on project-owned resources |
| `tenant_id` | Organization or participant-owned data boundary | Required where multi-tenancy applies |
| `principal_id` | Stable internal identifier within an identity authority | Opaque; do not expose provider secrets |
| `issuer` | Authentication authority that issued the identity assertion | Exact issuer URL/identifier |
| `subject` | Subject identifier from that issuer | Pair with issuer; not globally unique alone |
| `resource_id` | Stable identifier for the resource | Scoped by project and tenant |
| `contract_version` | Version of the contract used | SemVer or explicit schema version |

Do not assume `principal_id` is shared across apps. Use an explicit, auditable mapping table when accounts are linked.

## 3. Identity mapping record

Illustrative shape (not a database migration):

```json
{
  "mapping_id": "opaque-id",
  "project_id": "timeauction",
  "tenant_id": "tenant-opaque-id",
  "principal_id": "internal-principal-id",
  "issuer": "https://identity.example.invalid",
  "subject": "issuer-subject",
  "link_status": "active",
  "consent_ref": "consent-record-id",
  "created_at": "2026-11-13T00:00:00Z",
  "revoked_at": null
}
```

The example issuer is intentionally non-routable. Replace it only with a verified identity provider. Store the minimum attributes required; do not copy full profiles between products by default.

## 4. Authentication and authorization

- Validate issuer, audience, signature, expiry, and relevant token claims at the service boundary.
- Authorize every request against the requested project, tenant, resource, and action.
- Use least-privilege service identities and short-lived credentials.
- Do not trust a client-supplied `tenant_id` without checking it against authenticated authorization context.
- Keep user-facing identity linking separate from service-to-service trust.
- Support unlinking and revocation; define what happens to records created while a link was active.
- Record administrative access and authorization changes in an auditable log.

## 5. Consent record

An explicit consent record should identify:
- Subject/principal and the acting product.
- Purpose and specific data/actions covered.
- Recipient or destination product, where applicable.
- Scope, start time, expiry, and revocation state.
- Consent text/version and the method used to capture confirmation.
- Evidence reference and audit timestamp.

Silence, prior participation, inferred agreement, or a relayed statement is not consent. Revocation must block future use within the stated scope and trigger documented downstream handling.

## 6. Event envelope

Use CloudEvents or a similarly specified envelope only when event exchange is needed. The following is a conceptual example:

```json
{
  "specversion": "1.0",
  "id": "event-opaque-id",
  "source": "urn:lost-legacies-live:timeauction",
  "type": "com.lostlegacies.contribution.created.v1",
  "subject": "resource-opaque-id",
  "time": "2026-11-13T00:00:00Z",
  "datacontenttype": "application/json",
  "data": {
    "project_id": "timeauction",
    "tenant_id": "tenant-opaque-id",
    "resource_id": "resource-opaque-id",
    "contract_version": "1.0.0"
  }
}
```

Do not put private content or sensitive identity attributes in event metadata. Event payload access must be authorized independently. Define delivery guarantees, ordering, retention, retries, dead-letter handling, and replay protection for each event type.

## 7. Idempotency contract

For retryable commands:
- Require an idempotency key scoped to principal, tenant, and operation.
- Bind the key to a request hash; reject reuse with a materially different payload.
- Persist the operation state and result for a documented retention window.
- Return the original result for a duplicate completed request.
- Define behavior for in-progress, failed, and expired keys.
- Never use a client-generated key as proof of identity or authorization.

The Redis pattern in the Phase 1 roadmap is a proposed implementation option, not a requirement to adopt Redis before architecture review.

## 8. Provenance and content type

New records should distinguish:
- `ORIGINAL`
- `QUOTE`
- `RELAY`
- `SUMMARY`
- `INTERPRETATION`

Provenance state should distinguish `UNVERIFIED`, `PARTIALLY_VERIFIED`, and `TECHNICALLY_VERIFIED`. Use the last value only after validating a real authentication or integrity mechanism, such as a signature tied to a known key. Display markers and historical speaker notation are attribution hints, not cryptographic verification.

Preserve source references and transformation history when content is quoted, summarized, translated, or generated. Do not silently turn a relay or interpretation into an original statement.

## 9. Data lifecycle

Each contract owner must specify:
- Data classification and purpose.
- Minimum required fields.
- Storage location and authoritative system.
- Retention and deletion rules.
- Export and portability behavior.
- Audit access and access review.
- Cross-border or third-party processing, if applicable.
- Backup and recovery expectations.

Secret Rooms and private Time Engine prototypes must remain private by default. A private reflection or symbolic state must not trigger external messaging, publication, payments, token issuance, or access to another participant's private space.

## 10. Acceptance tests before adoption

- A principal from Product A cannot access Product B data without an explicit mapping and authorization.
- A tenant cannot enumerate another tenant's resources by changing an identifier.
- Revoked consent blocks subsequent cross-product reads and writes.
- A relayed or unverified statement cannot satisfy authentication or consent requirements.
- Repeated idempotent requests do not duplicate the side effect.
- Reusing an idempotency key with a different request body is rejected.
- Event replay is detected or safely handled.
- Private records are not included in public events, analytics, or logs.
- Data export and deletion are tested across downstream copies.

## 11. Open decisions

- Canonical identity authority, if any, and account-linking UX.
- Whether each product retains its own identity provider.
- Tenant model for individual, community, and organization accounts.
- API gateway versus product-owned API boundaries.
- Event transport and delivery guarantees.
- Consent evidence and revocation propagation.
- Data retention, deletion, and audit policy by product.

These decisions require product-owner, security, and privacy review. This document does not authorize cross-product data sharing or production identity migration.
