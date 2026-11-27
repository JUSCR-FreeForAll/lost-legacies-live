# Phoenix Fortress: Protection and Recovery Architecture for People, Identity, Data, Devices, and Service Continuity

## Scope, safety boundary, and design objective

Phoenix Fortress should be defined as a consent-based digital protection and recovery system, not as a promise that it can “protect anyone” in every circumstance. Its defensible mission is narrower and more useful: help a person preserve or regain control of their digital identity, accounts, credentials, important data, trusted devices, and essential service access after events such as account takeover, device loss, ransomware, malicious administration, coercive control, displacement, disaster, network isolation, or forgotten credentials. It can additionally preserve user-selected evidence and provide referrals or escalation paths, but it cannot substitute for physical rescue, emergency dispatch, medical care, shelter, law enforcement, legal representation, or human safety planning. NIST's current identity guidance similarly treats account recovery as a distinct, risk-managed process for regaining control of authenticators rather than a guarantee of identity or safety. [1]

That distinction matters especially for survivors of abuse or stalking. Technology that appears protective can itself become dangerous when an abusive person controls the device, email account, cloud account, recovery contact, location sharing, or browser history. The National Domestic Violence Hotline warns that devices may be monitored without the user knowing, that browsing traces cannot necessarily be completely erased, and that account or device changes can expose safety planning. The Safety Net Project likewise recommends assessing whether a device is safe before changing access or documenting abuse and notes that disabling another person's access can sometimes trigger escalation. Phoenix Fortress should therefore never silently track location, automatically contact third parties, reveal recovery activity to other household members, or force disclosure of personal circumstances. [2]

The strongest interpretation of “anyone” is consequently an inclusion requirement: Fortress should work for people with disabilities, limited connectivity, limited technical literacy, different languages, shared-device constraints, lost or stolen devices, and no blockchain access. W3C WCAG 2.2 explicitly includes accessibility for users with visual, auditory, mobility, speech, cognitive, and learning disabilities, while its Accessible Authentication criteria require an authentication path that does not depend solely on cognitive tests such as remembering information or solving puzzles, including during account recovery. [3]

The resulting product principle should be:

> Phoenix Fortress protects recoverability without taking ownership of the person.

Core recovery must function locally and offline. GitHub, Replit, cloud storage, Solana, JSON-LD exchanges, CRDT peers, recovery contacts, and institutional providers are integrations—not roots of trust.

## Threat model and non-negotiable security invariants

The initial threat model should explicitly cover six failure families. Account takeover includes stolen passwords, session tokens, phishing, unauthorized authenticator enrollment, and recovery-channel compromise; OWASP recommends reauthentication for sensitive account changes, generic recovery responses that resist account enumeration, and strong session protections, while CISA recommends phishing-resistant MFA and rapid disabling and replacement of lost authenticators. [4]

Device loss or compromise includes theft, destruction, inaccessible encryption keys, malware, and hostile physical access. Passkeys help because WebAuthn credentials are public-key credentials scoped to the relying party, and the August 25, 2026 WebAuthn Level 3 Recommendation gives a standardized basis for strong user-mediated authentication. FIDO notes that synchronized passkeys can survive device replacement, while device-bound FIDO security keys can serve as reserve recovery credentials. Recovery must nevertheless remain possible without a particular passkey ecosystem. [5]

Ransomware or storage destruction includes encrypted primary data, corrupted replicas, compromised backup credentials, and restoration from an infected snapshot. NIST recommends regular backup testing and offline copies; its 2026 OT Backup Quick Start Guide emphasizes integrating backups into change control, creating them regularly, testing them, and exercising recovery. CISA similarly recommends isolating backup systems and restoring from known-clean backups rather than assuming the compromised primary system remains trustworthy. [6]

Malicious insiders and whole-ledger rewriting are especially important to the existing SovereignChain concept. A hash chain proves that the current sequence is internally self-consistent; it does not prove that a privileged actor did not replace the whole database and recompute every hash. Fortress therefore needs independent signed checkpoints, multiple trust domains, and externally exportable verification receipts. Where JSON is hashed or signed, a defined canonical representation is essential; RFC 8785 exists specifically to make JSON serialization invariant for cryptographic operations. JSON-LD/RDF interoperability needs its own canonicalization layer, for which W3C RDFC-1.0 is the current Recommendation. [7]

Coercive control differs from ordinary unauthorized access because the attacker may know passwords, have legitimate-looking access, possess the device, control communications, or be an approved recovery contact. Fortress therefore cannot equate “knows the secret” with “has freely given consent.” Survivor-facing recovery should permit a user to remove or replace a recovery contact without disclosing the new contact to the old one; notifications must be configurable by safe channel; sensitive records should be stored only when the user chooses; and recovery workflows must not automatically alert a potentially abusive joint account holder. Survivor safety organizations specifically recommend using safer devices and accounts for sensitive changes and warn that technology changes may alter an abuser's behavior. [8]

Network partition or provider failure covers loss of internet, DNS, GitHub, Replit, passkey synchronization providers, cloud KMS, or Solana. Consequently, a Fortress instance that has an intact local state and valid local recovery credentials must still boot, verify itself, accept authorized local recovery operations, export encrypted recovery material, and later reconcile optional remote checkpoints. NIST incident-response guidance emphasizes integrating preparation, detection, response, and recovery throughout risk management rather than depending on one external mechanism. [9]

From those threats, the MVP should enforce these invariants:

- No recovery pathway is weaker by default than the protected account. FIDO explicitly recommends that recovery not depend on weaker factors than the credential being recovered. [10]

- No privileged state mutation is anonymous. Every mutation has an authenticated actor or explicitly declared local-recovery actor, an authorization decision, an idempotency key, and a durable audit event. OWASP recommends auditing secret and administrative lifecycles while excluding plaintext secrets from logs. [11]

- No secret appears in the SovereignChain, Socket.IO broadcast, logs, exception trace, JSONL archive, or recovery receipt. OWASP explicitly states that secrets should not be logged and should be revocable and lifecycle-auditable. [11]

- Compromised keys are revocable. NIST key-management guidance says compromised recovered keys must be revoked, and replacement keys generated when continued operation is required. [12]

- The chain boot process is fail-closed. Missing genesis, discontinuous indices, malformed canonical payloads, incorrect predecessor hashes, invalid signatures, unsupported schema versions, or a checkpoint contradiction puts the node into RECOVERY_REQUIRED, not READY.

- Recovery is revocable and observable by the recovering user without being unnecessarily observable to others. NIST's current account-recovery guidance requires notifications after account recovery and permits recovery contacts and saved or issued recovery codes; Fortress should implement those concepts while allowing a survivor-safe notification policy rather than assuming one email or phone is always safe. [13]

- Blockchain availability is never a boot dependency. Solana should prove historical checkpoints when available; it should never hold the only recovery secret or determine whether an offline person may recover local data.

## Protection and recovery architecture

The existing Flask/Socket.IO/SQLite service can remain the operational core, but the ledger should cease being the place where sensitive content lives. Instead, Phoenix Fortress should separate identity metadata, encrypted recovery objects, audit commitments, and external checkpoints.

A practical state model is:

```text
                    ┌───────────────────────────────┐
                    │ User / trusted local client   │
                    └───────────────┬───────────────┘
                                    │
                              WebAuthn / local
                              recovery credential
                                    │
                    ┌───────────────▼───────────────┐
                    │      Fortress API Gateway     │
                    │ authn • authz • rate limits   │
                    │ consent • idempotency         │
                    └───────┬───────────┬───────────┘
                            │           │
                ┌───────────▼──┐     ┌──▼────────────────┐
                │ Recovery     │     │ SovereignChain    │
                │ Orchestrator │     │ event commitments │
                └──────┬───────┘     └──┬────────────────┘
                       │                 │
                ┌──────▼──────────┐  ┌──▼────────────────┐
                │ Encrypted Vault │  │ SQLite WAL        │
                │ recovery packs  │  │ + atomic outbox   │
                └──────┬──────────┘  └──┬────────────────┘
                       │                 │
             encrypted backups          │ append/export
                       │                 │
        ┌──────────────▼────────┐   ┌────▼───────────────┐
        │ user-selected media   │   │ signed checkpoints │
        │ USB / disk / storage  │   │ + JSONL receipts   │
        └───────────────────────┘   └────┬───────────────┘
                                        │ optional
                       ┌────────────────┼─────────────────┐
                       ▼                ▼                 ▼
                    Peer/CRDT       institutional      Solana
                    replica         checkpoint         anchor
```

The ledger should contain events such as AUTHENTICATOR_BOUND, AUTHENTICATOR_REVOKED, RECOVERY_STARTED, RECOVERY_APPROVED, RECOVERY_COMPLETED, BACKUP_CREATED, BACKUP_VERIFIED, and CHECKPOINT_EXPORTED, but it should store hashes or opaque object identifiers rather than passwords, recovery codes, evidence photographs, identity documents, private keys, or full account exports. That separation follows OWASP's principle of preventing sensitive secrets from entering logs while retaining enough auditable lifecycle information for incident response. [14]

### Canonical chain format

Replace the current float timestamp and Python-specific JSON serialization with an explicitly versioned canonical envelope:

```text
{
  "v": 1,
  "idx": 418,
  "event_id": "019b...",
  "occurred_at_us": 1795728123456789,
  "event_type": "AUTHENTICATOR_REVOKED",
  "actor_id": "usr_7f...",
  "object_ref": "sha256:...",
  "prev_hash": "sha256:...",
  "idempotency_key_hash": "sha256:..."
}
```

Hash the UTF-8 bytes of a single documented canonicalization algorithm rather than formatting fields into a delimiter-separated string. RFC 8785 is designed for deterministic JSON hashing; JSON-LD data should first be normalized according to the W3C RDF Dataset Canonicalization Recommendation and should not silently reuse ordinary JSON canonicalization as though graph semantics were equivalent. [7]

Genesis should be deterministic per installation identity, not globally identical by accident. A deployment manifest should contain an explicit chain_id, schema version, canonicalization version, genesis policy, and initial trust key. The genesis block can then be reconstructed from that immutable manifest rather than time.time(). This makes restoration testable and removes the current ambiguity where creating a fresh database silently creates a new history.

### Atomic commits and archive consistency

The current /commit flow has a race between reading the tip and inserting the next block and has a second durability boundary between SQLite and the JSONL append. Convert writes to a BEGIN IMMEDIATE SQLite transaction, enforce idx = previous + 1, give every logical request a unique persistent idempotency key, and write an outbox record inside the same SQLite transaction. After commit, an exporter drains the outbox to JSONL or other archive targets. A crash can therefore cause delayed export, but it cannot create a committed block whose export status is unknowable.

The desired transaction is conceptually:

```text
BEGIN IMMEDIATE;

existing = SELECT response
             FROM idempotency
            WHERE key_hash = ?;

if existing:
    return existing

tip = SELECT idx, hash
        FROM blocks
    ORDER BY idx DESC
       LIMIT 1;

block = canonicalize_and_hash(...);

INSERT INTO blocks (...);
INSERT INTO idempotency (...);
INSERT INTO outbox (kind, object_hash, status)
VALUES ('BLOCK_EXPORT', block.hash, 'PENDING');

COMMIT;
```

/health should report READY only after chain verification, schema verification, key availability checks, and unresolved integrity conditions have completed. A separate /live endpoint can simply prove that the process is alive, preventing an orchestrator from mistaking “process exists” for “integrity verified.”

### Identity and recovery methods

For ordinary web authentication, make WebAuthn/passkeys the preferred method, with multiple authenticators allowed per person. W3C WebAuthn Level 3 standardizes public-key credentials and user consent mediation, while CISA identifies FIDO/WebAuthn as the broadly available phishing-resistant MFA approach. Users should be encouraged—not required—to enroll more than one independent authenticator, for example a synced passkey plus a separate security key. [15]

Recovery should support several independent routes because no single route is safe for everyone:

```text
Normal recovery
 ├─ remaining strong authenticator
 ├─ saved offline recovery code
 ├─ reserve hardware authenticator
 ├─ recovery-contact quorum
 └─ assisted re-proofing / human escalation

High-risk recovery
 ├─ delay where appropriate
 ├─ additional independent evidence
 ├─ revoke old authenticators
 ├─ terminate old sessions
 ├─ issue fresh keys
 └─ notify only through user-approved safe channels
```

NIST SP 800-63B-4 recognizes saved recovery codes, issued recovery codes, recovery contacts, and repeated identity proofing as recovery methods and requires saved recovery secrets to have sufficient randomness and recovery attempts to be throttled. It also requires recovery notification. [13]

A recovery-contact feature should therefore be quorum-based rather than single-contact authority when the risk warrants it. Contacts should never receive the user's master private key, password, full recovery archive, location, personal history, or names of other contacts. Their capability should be limited to authorizing one narrowly scoped recovery ceremony. The user must be able to inspect, rotate, and revoke those contacts, consistent with NIST's requirement that users be able to manage recovery contacts. [16]

For particularly sensitive deployments, Fortress can split the ability to unlock an encrypted recovery package across multiple independently held shares so that no one helper can recover it alone. That should be offered as an advanced policy, not imposed universally: quorum systems fail when helpers disappear, collude, become coercive, or are inaccessible during displacement. There must always be an explicit recovery-policy document explaining which failures the chosen configuration tolerates.

### Recovery vaults and backups

The recovery vault should encrypt its contents independently of the SQLite database. A package might contain the user's selected account inventory, export manifests, public-key metadata, encrypted credential escrow where appropriate, service recovery instructions, and verified backup references. Encryption keys should have defined generation, storage, rotation, compromise, revocation, backup, and destruction procedures; NIST's key-management guidance expressly treats backup, compromise, key recovery, storage, and trust anchors as lifecycle concerns. [17]

A useful portable format is:

```text
fortress-recovery-2026-11-26.pfr
├── manifest.json
├── manifest.sig
├── vault/
│   ├── identity.enc
│   ├── accounts.enc
│   ├── recovery.enc
│   └── user_documents.enc
├── ledger/
│   ├── checkpoint.json
│   └── checkpoint.sig
└── VERIFY.txt
```

The package should be self-describing, versioned, decryptable without Phoenix Fortress's cloud infrastructure, and verifiable with a small offline verifier. Offline copies are particularly important against ransomware; NIST and CISA guidance both emphasize protected, testable backups and restoration from known-clean copies. [6]

Backups are not considered valid merely because a file was written. A BACKUP_CREATED event should later be paired with BACKUP_VERIFIED, representing a real decrypt/verify exercise against an isolated temporary location. This is aligned with NIST's 2026 backup guidance emphasizing regular testing and recovery exercises. [18]

## Survivor-safe, accessible, multilingual recovery

Phoenix Fortress should include a Safe Recovery mode whose first question is not “what happened?” but effectively “is this device safe for recovery activity?” That mode should offer a neutral interface title, suppress optional notifications, avoid showing contact names on the landing screen, avoid browser persistence by default, and warn that software cannot reliably conceal its use from a compromised device. The Hotline and Safety Net Project both caution that compromised or monitored devices can expose planning activity and recommend using safer devices or accounts for sensitive changes. [19]

Safe Recovery must not implement a disguised “panic button” that promises invisibility. A hostile administrator, spyware, device-level monitoring system, DNS logger, synchronized browser history, or cloud account may still reveal activity. The interface can instead provide a clearly worded Quick Exit control while explaining its limitation and allowing users to choose whether a recovery session leaves local history. Survivor resources emphasize that browsing traces may persist and that seemingly protective technology itself can expose the user. [20]

Evidence preservation should be opt-in. If someone chooses to record technology abuse or stalking, Fortress may create integrity hashes, timestamps, and encrypted copies without publishing their content. Safety Net recommends documenting only relevant information, warns that documentation itself can create risk if discovered, and notes that originals may still be important for investigation. Fortress therefore should describe its evidence feature as integrity-preserving storage—not as legal proof, admissibility certification, or automatic police reporting. [21]

Accessibility must apply to recovery, not merely the normal dashboard. WCAG 2.2's Accessible Authentication criteria mean there must be a path that does not require memory puzzles or recognition tasks, including during recovery. At minimum, Fortress should support keyboard navigation, screen readers, text scaling, non-color status cues, sufficient focus indicators, no inaccessible CAPTCHA as the sole recovery gate, copy/paste and password-manager support, printable recovery material, plain-language explanations, and a workflow that can be translated without changing cryptographic semantics. [3]

For multilingual operation, user-facing strings should be externalized from the security logic and use stable message identifiers:

```text
{
  "message_id": "recovery.authenticator.revoked",
  "severity": "security",
  "variables": ["device_name", "revoked_at"]
}
```

The ledger commits the message identifier and security event—not the translated prose—so changing translations cannot change historical hashes. Recovery kits should include language-independent identifiers and a plaintext VERIFY.txt translated into the user's chosen languages where practical.

For users without internet, phone service, or cloud accounts, an offline recovery ceremony should work from a bootable or locally installed Fortress package, a recovery code or security key, and the encrypted recovery package. Network availability may add more evidence or checkpoints but must not be required to decrypt a user-owned offline archive.

## GitHub, Replit, and implementation-ready repository plan

I do not have an authenticated GitHub or Replit connector exposed in this research session, so I could not inspect, modify, commit, deploy, or test a private Phoenix Fortress repository or Replit application. A public web search for the project names did not identify a clearly attributable Phoenix Fortress repository or Replit app; the results were unrelated products and projects. I therefore cannot truthfully claim that any repository, deployment, branch, CI workflow, secret, database, or Replit project has been changed. [22]

The implementation repository should be decomposed so that integrity verification and recovery do not depend on Flask:

```text
phoenix-fortress/
├── fortress/
│   ├── api/
│   │   ├── auth.py
│   │   ├── commit.py
│   │   ├── health.py
│   │   └── recovery.py
│   ├── core/
│   │   ├── canonical.py
│   │   ├── chain.py
│   │   ├── checkpoint.py
│   │   ├── genesis.py
│   │   ├── idempotency.py
│   │   └── policy.py
│   ├── crypto/
│   │   ├── envelope.py
│   │   ├── keys.py
│   │   ├── signatures.py
│   │   └── recovery_codes.py
│   ├── identity/
│   │   ├── authenticators.py
│   │   ├── contacts.py
│   │   ├── sessions.py
│   │   └── webauthn.py
│   ├── recovery/
│   │   ├── ceremony.py
│   │   ├── export.py
│   │   ├── restore.py
│   │   ├── revoke.py
│   │   └── survivor_safe.py
│   ├── storage/
│   │   ├── sqlite.py
│   │   ├── outbox.py
│   │   ├── archive.py
│   │   └── migrations.py
│   └── adapters/
│       ├── jsonld.py
│       ├── crdt.py
│       └── solana.py
├── verifier/
│   └── verify_chain.py
├── schemas/
├── translations/
├── tests/
│   ├── unit/
│   ├── property/
│   ├── adversarial/
│   ├── recovery/
│   ├── accessibility/
│   └── integration/
├── vendor/
│   └── wheels/
├── scripts/
│   ├── build-offline-bundle.sh
│   ├── restore-drill.sh
│   └── verify-release.sh
├── .github/
│   ├── CODEOWNERS
│   ├── dependabot.yml
│   └── workflows/
│       ├── ci.yml
│       ├── codeql.yml
│       ├── dependency-review.yml
│       ├── release.yml
│       └── recovery-drill.yml
├── Dockerfile
├── compose.yaml
├── requirements.in
├── requirements.lock
├── fortress.manifest.json
├── SECURITY.md
├── THREAT_MODEL.md
├── RECOVERY.md
└── README.md
```

The current requirements.txt pins only direct dependencies. For genuinely reproducible offline installation, create a fully resolved lock containing hashes for every transitive dependency and build a vendor/wheels/ bundle for the supported Python/runtime platforms. CI should install once from the network to build and attest that bundle, then run a second install with network access disabled using only the lock and wheelhouse. “Pinned Flask” alone does not establish supply-chain reproducibility.

GitHub Actions should run with explicit minimal permissions, and third-party actions should be workflow-locked or pinned to reviewed full commit SHAs. GitHub's current guidance recommends least-privilege workflow permissions and states that workflow dependency lockfiles are stronger than tag references, with full-SHA pinning as the fallback. [23]

A protected main ruleset should require pull requests, security CI, chain-vector tests, recovery tests, and signed commits for protected release paths. GitHub rulesets can require verified signed commits and layer multiple protections, with the most restrictive applicable rules prevailing. Dependency review can block new vulnerable dependencies in pull requests, and CodeQL is available for public repositories by default. [24]

Release CI should produce the container image, offline wheel bundle, source archive, standalone verifier, SBOM, checksums, and build provenance. GitHub artifact attestations can bind build artifacts or images to the repository, workflow, commit, and build context, and can include SPDX or CycloneDX SBOM predicates. Those attestations are useful for software-supply-chain provenance but must remain separate from an individual's Fortress recovery trust chain. [25]

The minimum automated tests should include:

```text
chain:
  deterministic genesis
  deterministic canonical vectors
  index-gap rejection
  predecessor mismatch rejection
  payload mutation rejection
  checkpoint contradiction rejection
  unsupported canonicalization-version rejection

concurrency:
  100 simultaneous commits -> 100 unique sequential blocks
  duplicate idempotency key -> one state mutation
  crash after DB commit before export -> outbox recovers

recovery:
  lost primary authenticator
  stolen authenticator revoked
  all network unavailable
  recovery contact unavailable
  malicious recovery contact
  old recovery token replay
  compromised backup key rotation
  restoration from oldest supported package version

storage:
  truncated SQLite WAL
  truncated JSONL
  missing archive
  corrupted encrypted backup
  disk-full during commit
  disk-full during archive export

privacy:
  no secret in logs
  no secret in Socket.IO event
  no recovery code in ledger
  no location collection without explicit feature consent

survivor safety:
  contact removal does not notify removed contact
  safe-channel notification policy respected
  recovery can be performed from a different device
  no hidden tracking call

accessibility:
  keyboard-only recovery
  screen-reader labels
  zoom/reflow
  no memory puzzle required
  translated interface preserves event semantics
```

Those tests directly target the failure classes highlighted by NIST, OWASP, CISA, W3C, and survivor-safety guidance rather than merely checking whether /health returns HTTP 200. [26]

### Replit deployment path and limits

For Phoenix Fortress on Replit, a Reserved VM is the safer fit than a static deployment and more predictable than an elastic instance for a long-running Socket.IO service. Replit describes Reserved VM deployments as dedicated always-on resources suited to persistent API servers and connected applications. Replit deployment supports published-app secrets, custom port mappings, and HTTPS replit.app endpoints; its custom-domain documentation states that Replit provides TLS certificates for both Replit subdomains and custom domains. [27]

The Replit run command should bind a single externally exposed port and listen on a non-loopback interface, because current Replit deployment documentation allows only one external port for Autoscale and Reserved VM deployments and warns that the internal service must not bind exclusively to localhost. [28]

Production secrets—signing keys, WebAuthn-related configuration, session secrets, checkpoint keys—belong in Replit deployment secrets or an external secret manager, never .env committed to Git. Replit exposes dedicated published-app secrets configuration, while OWASP recommends least privilege, revocability, rotation, and prevention of secret logging. [29]

Do not make Replit's local filesystem the only copy of Fortress state. Replit provides managed SQL database and App Storage options for persistent application data, and its documentation explicitly recommends persistent storage for application state. A Phoenix deployment should therefore either use a storage design verified against Replit's production persistence semantics or treat Replit as an application node whose authoritative encrypted archives are replicated elsewhere. The local-first distribution should continue using SQLite on environments where filesystem durability is under the operator's control. [30]

Replit is also not the offline distribution. The air-gapped artifact must remain independently installable from the release bundle with no Replit, GitHub, PyPI, Solana, DNS, or cloud database dependency. Replit should be one hosted deployment target, not the canonical survival mechanism.

## Phased roadmap and verification gates

### MVP: make Fortress trustworthy before making it broad

The first milestone should contain no Solana dependency, no CRDT write merging, and no automated survivor reporting. It should replace the security weaknesses already visible in the prototype: unauthenticated /commit, race-prone tip selection, nondeterministic genesis, float-based hashing, permissive CORS, default production secret, non-atomic JSONL export, incomplete boot verification, and lack of an external trust checkpoint.

MVP deliverables should be:

- deterministic versioned genesis and canonical JSON hashing;

- atomic SQLite BEGIN IMMEDIATE commits and durable idempotency;

- transactional outbox and resumable JSONL export;

- fail-closed full verification before readiness;

- authenticated/authorized commits;

- WebAuthn/passkey enrollment with multiple authenticators;

- saved offline recovery codes;

- encrypted portable recovery packages;

- authenticator and session revocation;

- safe notification channels;

- backup creation and restoration verification;

- standalone offline chain/package verifier;

- accessible recovery UI;

- survivor-safe mode;

- signed offline checkpoints;

- fully locked/offline-installable dependency bundle.

This prioritization is consistent with NIST's recovery, backup, key-management and incident-response guidance and CISA's emphasis on strong authenticators and tested recovery of lost devices. [31]

The MVP does not ship until these gates actually pass:

```text
GATE                         REQUIRED RESULT
---------------------------  ---------------------------------------------
fresh installation           deterministic expected genesis
offline boot                 READY without network access
tampered block               boot fails closed
rewritten ledger             trusted checkpoint contradiction detected
concurrent commit test       no duplicate idx / lost block
request replay               no second mutation
crash before archive export  outbox resumes safely
lost device                  reserve recovery succeeds
stolen device                authenticator + sessions revoked
ransomware drill             known-clean offline backup restores
bad backup                   restoration rejected
secret scan                  no plaintext protected secret
accessibility review         recovery path keyboard/AT operable
safe-mode review             no covert tracking or forced disclosure
```

### Protection phase: person-centered recovery

The next phase adds recovery contacts, optional quorum policies, assisted recovery workflows, multilingual packs, export/import from password managers and major service providers, configurable “safe channel” notification policy, guardian rotation, and user-controlled encrypted evidence storage. NIST's current recovery model explicitly supports recovery contacts and repeated proofing; survivor resources demonstrate why the user must retain control over whether and how sensitive actions are communicated or documented. [32]

Human escalation should be a referral framework, not a universal Phoenix-run emergency service. Depending on user choice and jurisdiction, the interface can direct users to service providers, domestic-violence advocates, emergency services, legal aid, cybersecurity incident responders, or organizational administrators. It should not silently transmit the user's identity, location, account data, evidence, or circumstances to any referral destination.

### Resilience phase: multiple independent trust domains

Next add independently signed checkpoints and peer replication. A checkpoint contains the chain identifier, height, tip hash, canonicalization version, timestamp, and signer identity. It contains no private recovery material. Users can export checkpoints to removable storage, another Fortress node, an institutional signer, or an optional public timestamping/anchoring mechanism.

CRDT support should initially be restricted to data types whose merge semantics are safe. Authentication state, revocation state, key rotation, consent changes, evidence deletion policy, and recovery authorization should not be made eventually consistent merely because a CRDT can merge them. Security-sensitive transitions require explicit conflict rules and monotonic revocation semantics.

### Interoperability phase: JSON-LD and Seamcraft

JSON-LD/Seamcraft adapters should transform external envelopes into an internal validated event rather than letting arbitrary graph data directly become a chain block. Incoming envelopes should pass schema validation, size limits, sender authentication where required, replay/idempotency validation, explicit consent/authorization, and canonicalization. If RDF/JSON-LD content itself is cryptographically bound, use W3C RDFC-1.0 rather than assuming textual JSON order defines graph identity. [33]

A suitable interface is:

```text
class FortressAdapter(Protocol):
    def validate(self, envelope: bytes) -> ValidatedEnvelope: ...
    def authorize(
        self,
        envelope: ValidatedEnvelope,
        actor: Actor,
        consent: ConsentContext,
    ) -> AuthorizationDecision: ...
    def canonical_event(
        self,
        envelope: ValidatedEnvelope,
    ) -> FortressEvent: ...
```

Adapters never receive raw vault keys and cannot bypass the core authorization or idempotency layers.

### External-proof phase: optional Solana anchoring

Only after local recovery is mature should Solana anchoring be introduced. The anchor payload should contain a checkpoint commitment such as:

```text
{
  "chain_id": "pf:...",
  "height": 8192,
  "tip_hash": "sha256:...",
  "checkpoint_hash": "sha256:..."
}
```

No name, email, recovery contact, device ID, evidence, account inventory, credential, IP address, or location belongs on-chain. Solana failure, congestion, loss of wallet access, or network isolation must never prevent local boot or recovery. Its value is providing an independently observable historical commitment that makes whole-ledger replacement harder to hide; it is not the Fortress database, identity provider, consent authority, or recovery key escrow.

## Recovery drills and operational definition of success

Phoenix Fortress should measure recovery by demonstrated drills rather than architecture claims. NIST's incident-response guidance stresses preparation and improvement across detection, response and recovery, and its 2026 backup guidance emphasizes testing backups and exercising recovery. [34]

Every release candidate should therefore undergo at least these scenarios: a person loses the only daily-use phone; an attacker steals an active authenticated device; an abusive recovery contact attempts a recovery without the user; the database is modified by hand; the JSONL archive is truncated; all internet connectivity disappears; GitHub and Replit are unavailable; the primary backup is encrypted by simulated ransomware; a recovery key is declared compromised; a user with a screen reader performs recovery; and an older recovery package is restored using only the offline verifier and current release bundle.

The final acceptance condition should not be “Phoenix Fortress can protect and recover anyone.” A defensible condition is:

A conforming Phoenix Fortress release can preserve or restore authorized control of supported digital assets across its documented threat scenarios, without requiring network or blockchain availability, without covertly tracking the person, without exposing recovery secrets in its audit system, and while clearly identifying cases that require human, emergency, medical, legal, platform-provider, or specialist assistance.

That standard is deliberately demanding. It turns “protect and recover anyone” from an impossible universal guarantee into an engineering discipline: make recovery voluntary, portable, independently verifiable, accessible, abuse-resistant, offline-capable, revocable, testable, and survivable when the infrastructure around the person fails.

[1] [13] [31] NIST Special Publication 800-63B

https://pages.nist.gov/800-63-4/sp800-63b.html?utm_source=chatgpt.com

[2] [8] [19] [20] Internet Safety for Survivors | The National Domestic Violence Hotline

https://www.thehotline.org/plan-for-safety/internet-safety/?utm_source=chatgpt.com

[3] Web Content Accessibility Guidelines (WCAG) 2.2

https://www.w3.org/TR/wcag/?utm_source=chatgpt.com

[4] Authentication - OWASP Cheat Sheet Series

https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html?utm_source=chatgpt.com

[5] Web Authentication: An API for accessing Public Key Credentials Level 3 is now a W3C Recommendation | 2026 | News | W3C

https://www.w3.org/news/2026/web-authentication-an-api-for-accessing-public-key-credentials-level-3-is-now-a-w3c-recommendation/?utm_source=chatgpt.com

[6] CSF 1.1 Quick Start Guide | NIST

https://www.nist.gov/cyberframework/csf-11-quick-start-guide?utm_source=chatgpt.com

[7] RFC 8785 - JSON Canonicalization Scheme (JCS)

https://datatracker.ietf.org/doc/html/rfc8785?utm_source=chatgpt.com

[9] [26] [34] Incident Response Recommendations and Considerations for Cybersecurity Risk Management: A CSF 2.0 Community Profile

https://csrc.nist.gov/pubs/sp/800/61/r3/final?trk=public_post_comment-text&utm_source=chatgpt.com

[10] White Paper: Displace Password + OTP Authentication with Passkeys | FIDO Alliance

https://fidoalliance.org/white-paper-displace-password-otp-authentication-with-passkeys/?query-cdbd12d0-page=5&utm_source=chatgpt.com

[11] [14] Secrets Management - OWASP Cheat Sheet Series

https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html?utm_source=chatgpt.com

[12] Recommendation for Key Management: Part 1 - General

https://nvlpubs.nist.gov/nistpubs/specialpublications/nist.sp.800-57pt1r5.pdf?utm_source=chatgpt.com

[15] Web Authentication: An API for accessing Public Key Credentials - Level 3

https://www.w3.org/TR/webauthn-3/?utm_source=chatgpt.com

[16] [32] Digital Identity Guidelines: Authentication and Authenticator Management

https://nvlpubs.nist.gov/nistpubs/SpecialPublications/NIST.SP.800-63B-4.pdf?utm_source=chatgpt.com

[17] Recommendation for Key Management: Part 1 – General

https://csrc.nist.gov/pubs/sp/800/57/pt1/r6/ipd?utm_source=chatgpt.com

[18] OT BACKUP QUICK START GUIDE

https://www.nist.gov/publications/ot-backup-quick-start-guide?utm_source=chatgpt.com

[21] Documentation Tips for Survivors — Safety Net Project

https://www.techsafety.org/documentationtips?utm_source=chatgpt.com

[22] Index of /AtlasTiles/

https://blackportal.cloud/AtlasTiles/?utm_source=chatgpt.com

[23] Protecting against security threats - GitHub Enterprise Cloud Docs

https://docs.github.com/en/enterprise-cloud%40latest/code-security/tutorials/secure-your-organization/protect-against-threats?utm_source=chatgpt.com

[24] Available rules for rulesets - GitHub Docs

https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets?utm_source=chatgpt.com

[25] Using artifact attestations to establish provenance for builds - GitHub Docs

https://docs.github.com/en/actions/how-tos/secure-your-work/use-artifact-attestations/use-artifact-attestations?utm_source=chatgpt.com

[27] [29] Replit Docs

https://docs.replit.com/fr/references/publishing/reserved-vm-deployments?utm_source=chatgpt.com

[28] Replit Docs

https://docs.replit.com/pt/references/project-setup/ports?utm_source=chatgpt.com

[30] Replit Docs

https://docs.replit.com/pt/references/data-and-storage/sql-database?utm_source=chatgpt.com

[33] RDF Dataset Canonicalization

https://www.w3.org/TR/2024/REC-rdf-canon-20240521/?utm_source=chatgpt.com