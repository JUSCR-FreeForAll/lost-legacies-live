/**
 * Stable message identifiers. The ledger and notification store commit only
 * the message_id and variables, never translated prose, so translations can
 * change without changing any historical hash.
 */
export type Locale = "en" | "es";
export const LOCALES: readonly Locale[] = ["en", "es"];

export interface MessageDef {
  severity: "info" | "security" | "warning";
  variables: readonly string[];
  en: string;
  es: string;
}

export const MESSAGES = {
  "recovery.code.used": {
    severity: "security", variables: ["remaining"],
    en: "A saved recovery code was used. {remaining} unused codes remain.",
    es: "Se usó un código de recuperación guardado. Quedan {remaining} códigos sin usar.",
  },
  "recovery.codes.regenerated": {
    severity: "security", variables: ["count"],
    en: "A new set of {count} recovery codes was created. Older codes no longer work.",
    es: "Se creó un nuevo juego de {count} códigos de recuperación. Los códigos anteriores ya no funcionan.",
  },
  "recovery.sessions.revoked": {
    severity: "security", variables: ["count"],
    en: "Other sign-in sessions were ended ({count}). Devices must sign in again.",
    es: "Se cerraron otras sesiones ({count}). Los dispositivos deben iniciar sesión de nuevo.",
  },
  "recovery.credentials.revoked": {
    severity: "security", variables: ["count"],
    en: "{count} API credentials were revoked.",
    es: "Se revocaron {count} credenciales de API.",
  },
  "recovery.ceremony.started": {
    severity: "security", variables: ["ready_at"],
    en: "A contact-assisted recovery was started. It cannot complete before {ready_at}. If this was not you, cancel it now.",
    es: "Se inició una recuperación asistida por contactos. No puede completarse antes de {ready_at}. Si no fue usted, cancélela ahora.",
  },
  "recovery.ceremony.approval_requested": {
    severity: "info", variables: [],
    en: "Someone you agreed to help has asked for a recovery approval. Approve only if they asked you directly.",
    es: "Alguien a quien aceptó ayudar solicitó una aprobación de recuperación. Apruebe solo si se lo pidió directamente.",
  },
  "recovery.ceremony.completed": {
    severity: "security", variables: [],
    en: "Contact-assisted recovery completed. Sessions and credentials were revoked and new recovery codes were issued.",
    es: "La recuperación asistida se completó. Se revocaron sesiones y credenciales y se emitieron nuevos códigos.",
  },
  "recovery.ceremony.cancelled": {
    severity: "security", variables: [],
    en: "A contact-assisted recovery was cancelled.",
    es: "Se canceló una recuperación asistida por contactos.",
  },
  "recovery.contact.changed": {
    severity: "info", variables: ["active"],
    en: "Your recovery contacts changed. {active} active contacts.",
    es: "Sus contactos de recuperación cambiaron. {active} contactos activos.",
  },
  "recovery_key.rotated": {
    severity: "security", variables: ["fingerprint"],
    en: "The recovery key was rotated. New fingerprint {fingerprint}.",
    es: "Se rotó la clave de recuperación. Nueva huella {fingerprint}.",
  },
  "evidence.stored": {
    severity: "info", variables: [],
    en: "An encrypted evidence item was stored with an integrity hash. This is not legal proof.",
    es: "Se guardó un elemento de evidencia cifrado con un hash de integridad. Esto no es prueba legal.",
  },
  "consent.changed": {
    severity: "info", variables: ["purpose", "state"],
    en: "Consent for {purpose} is now {state}.",
    es: "El consentimiento para {purpose} ahora está {state}.",
  },
  "integrity.recovery_required": {
    severity: "warning", variables: ["code"],
    en: "Integrity verification failed ({code}). Writes are paused until recovery.",
    es: "Falló la verificación de integridad ({code}). Las escrituras están en pausa hasta la recuperación.",
  },
  "backup.verified": {
    severity: "info", variables: ["count"],
    en: "{count} backups were decrypted and verified in isolation.",
    es: "Se descifraron y verificaron {count} copias de seguridad de forma aislada.",
  },
} as const satisfies Record<string, MessageDef>;

export type MessageId = keyof typeof MESSAGES;

export function isMessageId(id: string): id is MessageId {
  return Object.prototype.hasOwnProperty.call(MESSAGES, id);
}

export function renderMessage(id: MessageId, locale: Locale, vars: Record<string, string | number> = {}): string {
  const def = MESSAGES[id] as MessageDef;
  const template = def[locale] ?? def.en;
  return template.replace(/\{(\w+)\}/g, (_m, k: string) => (k in vars ? String(vars[k]) : `{${k}}`));
}

/** Every catalog entry must have both locales and identical placeholder sets. */
export function catalogProblems(): string[] {
  const problems: string[] = [];
  for (const [id, raw] of Object.entries(MESSAGES)) {
    const def = raw as MessageDef;
    for (const locale of LOCALES) {
      const text = def[locale];
      if (!text) { problems.push(`${id}:${locale}:missing`); continue; }
      const found = [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
      const declared = [...def.variables].sort().join(",");
      if (found !== declared) problems.push(`${id}:${locale}:placeholders`);
    }
  }
  return problems;
}
