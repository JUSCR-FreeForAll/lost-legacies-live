export const USER_GUIDE = `# Phoenix Fortress — how it protects you

**1. Set up your recovery key.** It is shown once. Store it offline (paper, a password manager you trust). Fortress keeps only an encrypted copy that it uses for you; extraction credentials can never read it.

**2. Save your recovery codes.** Ten one-time codes let you take your account back if someone else got in: using one ends every other session, revokes every API credential and gives you a replacement recovery key.

**3. Add recovery contacts (optional).** People you trust can approve a recovery together. Nothing happens until enough of them approve *and* the waiting period passes, and you can cancel at any time. Contacts are not told when you remove them.

**4. Back up and verify.** Every backup is encrypted with its own key. "Verify" re-checks every hash, signature and ciphertext. If anything was altered, Fortress stops accepting changes and shows **Recovery required** instead of guessing.

**5. Restore safely.** Restores always go to a separate staging copy after a dry run and a typed confirmation. Your source is never overwritten.

**6. Take a recovery package (.pfr).** It contains your encrypted data, the audit ledger and a signed checkpoint. It can be verified and decrypted on any computer with no internet.

**Safe Recovery mode** hides in-app notifications and **Quick Exit** (or the Esc key twice) leaves the app immediately.

Nothing is shared outside this service unless you grant the matching consent. You can withdraw consent at any time.`;
