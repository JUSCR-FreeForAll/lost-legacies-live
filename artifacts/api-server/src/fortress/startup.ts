/**
 * Startup verification state. Until full verification has succeeded in this
 * process, readiness is NOT_READY and ordinary ledger writes are refused.
 */
export type StartupState = "pending" | "running" | "succeeded" | "failed";

let state: StartupState = "pending";
let lastError: string | null = null;

export function startupState(): { state: StartupState; error: string | null } {
  return { state, error: lastError };
}

export function setStartupState(next: StartupState, error: string | null = null): void {
  state = next;
  lastError = error;
}

export function startupSucceeded(): boolean {
  return state === "succeeded";
}
