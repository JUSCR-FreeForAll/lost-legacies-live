# G13 — Accessibility review of the recovery path

Date: 2026-11-27. Reviewed against the frontend source at the time of this
commit (`artifacts/phoenix-fortress`). Backend unchanged, so `latest.json` is
unaffected.

**Status:** G13 is a manual gate, so the diagnostics page still shows
`not_verified`. This review has three parts: a code audit, a keyboard-only run
in a real browser by an automated tester that read the accessibility tree
(roles, names, focus, live regions), and a manual run on 2026-11-26 by a person
using a screen reader on iPhone with 200% zoom. That run passed, as reported by
the tester (see "Sign-off"). No Windows/NVDA run was done.

## Scope

| Flow | Page / component |
|---|---|
| Recovery key: create, confirm, rotate | `/recovery-key` (`pages/recovery-key.tsx`) |
| One-time recovery codes: generate, replace | `/recovery-key` |
| Lost device: sign out others, revoke credentials, recover with a code | `/emergency` (`pages/emergency.tsx`, `components/emergency-result.tsx`) |
| Recovery contacts: add, remove, policy, ceremonies, helper approvals | `/contacts` (`pages/contacts.tsx`) |
| Consent needed before contacts can be added | `/privacy` (consent switch only) |
| Quick exit: button and Esc Esc shortcut | `components/quick-exit.tsx`, app shell, landing page |
| Shell: skip link, navigation, mobile menu | `components/app-shell.tsx` |

## What was found and fixed

### Focus lost after an action (keyboard and screen reader users left on `<body>`)

Most recovery steps replace the button that was pressed. Focus then fell to the
page body, and a screen reader said nothing about the new content.

| Where | Fix |
|---|---|
| Moving between pages | Focus moves to `<main>` after client-side navigation (each route mounts its own shell, so the previous location is tracked at module level). |
| "Create recovery key", "Generate 10 codes", emergency recovery result | One-time secret boxes are labelled regions that take focus when they appear. |
| "I have written it down" | Focus goes to the re-type input. |
| Confirming the key | Focus moves to the key panel once the server reports it active. |
| Rotate → Cancel; codes → dismiss / Cancel | Focus returns to the button that opened the step. |
| "Generate a new set" (destroys unused codes) | Warning is `role=alert` and linked to the button; focus moves to **Cancel**, so pressing Enter twice cannot replace every code by accident. |
| Emergency: confirm dialogs (opened from plain buttons, so Radix had nowhere to return focus) | "Not now" / Escape returns focus to the opening button; success moves focus to the result message (`role=status`). |
| Emergency recovery result | Focus moves through replacement key → new codes → "Recovery complete" as each one is dismissed. |
| Contacts: add, remove, start/cancel/complete ceremony, approve helper | Focus goes to the label input (after add) or to the affected list. |
| Identity error "Retry" | A failed retry focuses the new Retry button; a successful one focuses `<main>`. |
| Consent switch (`/privacy`) | Used `disabled` while saving, which dropped focus. Now `aria-disabled` plus a guard. |

### Missing names, descriptions and announcements

- Field hints (minimum lengths, formats) were visible but not linked. `Field`
  now sets `aria-describedby` on its control. Hints added for the 40-character
  recovery key, the 16-character recovery code and the contact user ID. These
  explain why the submit button stays disabled.
- "Copied" only changed the button label, which screen readers don't reliably
  announce. Copy buttons and hash chips now have a `role=status` message.
- Ambiguous repeated buttons now have names: "Remove {label}", "Approve recovery
  for {label}", "Add contact", "Cancel this recovery ceremony".
- Fingerprint chip has a name ("…, copy full value").
- Consent switch label uses the human title, and changes are announced
  ("Recovery contacts: consent granted."). Safe Recovery mode switch had no
  name; it now does.
- "Complete recovery" explains when it becomes available, instead of being a
  silent disabled button.
- Loading skeletons say "Loading" (`role=status`).
- Decorative visuals (code-usage bars, approval bars, step numerals, bullet
  marks) are hidden from assistive tech; the same information is in text.

### Keyboard operation

- Added a "Skip to main content" link (first Tab stop).
- Navigation: `aria-label="Main"`, labelled groups, `aria-current="page"`.
- Mobile menu: the toggle has a name and `aria-expanded`; the menu is a modal
  dialog with a close button, Tab stays inside it, Escape closes it and
  returns focus to the toggle.
- Quick exit on the signed-out landing page was the *last* Tab stop (it is
  fixed bottom-right but rendered after the page). It is now first. Its name
  states the Esc Esc shortcut; the visual `<kbd>` hint is hidden from AT.
- Sign-out icon button now has a name.
- Focus rings: buttons and inputs went from a 1px ring to a 2px ring with
  offset; nav links and Quick exit use `focus-visible` rings.

### Zoom and contrast

- Alert dialogs could run off-screen at high zoom; they now cap at the
  viewport height and scroll.
- Warning colour (ochre) measured 3.3:1 on its tint and failed WCAG AA for small
  text. Darkened to 5.0:1.
- Sidebar group labels (2.7:1) and small sidebar text (4.1:1) raised to 5.2:1;
  "Lost device" link (3.5:1) raised to about 5:1.
- Privacy page safety rows now wrap instead of squeezing labels into a narrow column.

## Keyboard-only browser run (after fixes)

Run with Tab / Shift+Tab / Enter / Space / Escape only, 1280×800, on a fresh
dev user. The dev server ran with a throwaway encryption key for the run (dev
data was reset afterwards). Each result says where focus was afterwards.

| Step | Result |
|---|---|
| Tab from load → skip link visible; Enter → `<main>` | Pass |
| Create recovery key → secret region focused; Copy announces status | Pass |
| "I have written it down" → re-type input focused, hint linked | Pass |
| Re-type + Enter → toast, focus on key panel | Pass |
| Generate codes → region focused; dismiss → back to button | Pass |
| Generate a new set → focus on Cancel; Cancel → back to button | Pass |
| Rotate → current-key input focused; Cancel → back to Rotate | Pass |
| Sidebar link → new page, focus on `<main>`, `aria-current` set | Pass |
| Consent switch: Enter toggles, focus stays, change announced | Pass |
| Add contact → toast, focus to label input | Pass |
| Remove dialog: Tab stays inside; Keep → back to Remove button | Pass |
| Remove quietly → focus on contact list | Pass |
| Sign out everywhere else: Esc once closes, focus returns; confirm → status focused | Pass |
| Revoke all credentials: same | Pass |
| Recover with code → key region → codes region → "Recovery complete" | Pass |
| 640×400 viewport (≈200% zoom of 1280×800): no horizontal scroll, Skip → Quick exit → Open menu | Pass (app shell; see gaps) |
| Mobile menu: opens with focus on Quick exit, Tab trapped, Esc closes → toggle | Pass |
| Esc Esc → leaves to weather search | Pass |

Note: the automated tester's "Space" key did not toggle the consent switch.
The same Radix switch toggled on a real Space key event in headless Chromium
(checked separately), so this is a tester tool limitation, not an app bug.

## Remaining gaps

The manual iPhone run on 2026-11-26 covered items 1 and 2 on iOS. A desktop
screen reader run (NVDA) is still open.

1. **Desktop screen reader pass.** Run the steps above with NVDA + Firefox or
   Chrome (Windows) and VoiceOver + Safari (macOS/iOS). Listen for: secret
   boxes read as "Shown once, Your recovery key" with the note; hints read with
   the inputs; "Copied to clipboard", consent changes and errors announced
   once; the re-type field not echoing the key aloud in a way the user does not
   expect.
2. **200% browser zoom on the populated recovery pages.** The 640×400 run
   covered the shell and menu while the API was erroring. Check
   `/recovery-key` with a key and codes shown, `/emergency` with a result, and
   `/contacts` with contacts and a ceremony, at 200% browser zoom (and 400% for
   reflow): no horizontal scrolling, nothing clipped, dialogs scroll.
3. **Sign-in (Clerk) screens** are provided by Clerk and were not reviewed.
4. **Recovery-code entry when signed out.** The recovery code form is behind
   sign-in; a person who lost every device must first sign in through Clerk.
   This is a product question rather than an accessibility defect.

## Observed, not changed (outside G13)

- After "Sign out everywhere else" the status read "0 sessions ended via
  clerk", while the emergency result says "All signed out". The wording
  disagrees in the single-session case.
- Removed contacts stay listed with a "removed" badge rather than disappearing.

## Sign-off (to be completed by a person)

| Check | Tester | Date | Result |
|---|---|---|---|
| NVDA pass of the recovery path | | | Not done |
| VoiceOver pass of the recovery path (iPhone, Chrome; iOS screen reader is VoiceOver) | Jordan | 2026-11-26 | Pass: all steps worked, no problems reported |
| 200% zoom, populated pages (iPhone, Chrome) | Jordan | 2026-11-26 | Pass: nothing cut off |

The manual results above were reported by the tester in chat on 2026-11-26.
They did not give app or OS version numbers.
