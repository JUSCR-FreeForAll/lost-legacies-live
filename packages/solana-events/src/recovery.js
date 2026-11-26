import { formatEventKey } from "./index.js";

/**
 * Backfill finalized transactions missed while a WebSocket was disconnected.
 * The host must provide a history-capable RPC provider and an exact-version
 * transaction decoder that returns events in one deterministic total order.
 * An existing checkpoint (or explicitly chosen startingSignature) is mandatory:
 * silently assuming that a page covers the gap would lose events.
 */
export async function runFinalizedBackfill({
  provider, programId, programAddress = programId, store, decodeTransaction, onEvent, provenance,
  startingSignature, checkpointName = `solana:${programId}:finalized`,
  pageSize = 100, maxPages = 100
}) {
  if (!provider?.getSignaturesForAddress || !provider?.getTransaction ||
      !programId || !store?.getCheckpoint || !store?.setCheckpoint ||
      typeof decodeTransaction !== "function" || typeof onEvent !== "function") {
    throw TypeError("Missing finalized history provider or decoder");
  }
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 1000 ||
      !Number.isInteger(maxPages) || maxPages < 1) throw TypeError("Invalid scan bounds");
  const checkpoint = await store.getCheckpoint(checkpointName) ?? startingSignature;
  if (!checkpoint) throw Error("A verified finalized starting signature is required");
  let before;
  let newest = null;
  const missed = [];
  let found = false;
  for (let page = 0; page < maxPages; page++) {
    // @solana/web3.js v1 Connection: commitment is the *third* argument.
    const entries = await provider.getSignaturesForAddress(
      programAddress, { before, limit: pageSize }, "finalized");
    if (!Array.isArray(entries)) throw TypeError("History provider returned invalid page");
    if (!entries.length) break;
    for (const entry of entries) {
      if (!entry?.signature) throw TypeError("History entry lacks signature");
      newest ??= entry.signature;
      if (entry.signature === checkpoint) { found = true; break; }
      missed.push(entry);
    }
    if (found) break;
    before = entries.at(-1).signature;
    if (entries.length < pageSize) break;
  }
  if (!found) throw Error("Finalized checkpoint not found in provider history; gap unresolved");
  let ingested = 0;
  for (const entry of missed.reverse()) {
    const tx = await provider.getTransaction(entry.signature, {
      commitment: "finalized", maxSupportedTransactionVersion: 0
    });
    if (!tx || tx.slot == null || !tx.meta) throw Error(`Missing finalized transaction: ${entry.signature}`);
    if (tx.meta.err != null) continue; // failed transactions never produce app effects
    const events = await decodeTransaction(tx, {
      programId, signature: entry.signature, commitment: "finalized"
    });
    if (!Array.isArray(events)) throw TypeError("Decoder must return a fully ordered event array");
    for (const [eventIndex, parsed] of events.entries()) {
      if (!parsed?.name) throw TypeError("Decoder returned event without a name");
      const eventKey = formatEventKey({ programId, signature: entry.signature, eventIndex });
      const result = await store.put({
        eventKey, programId, signature: entry.signature, eventIndex, eventName: parsed.name,
        data: parsed.data ?? {}, slot: tx.slot, commitment: "finalized",
        observedAt: Date.now(), provenance: provenance ?? null
      });
      const token = await store.claim(eventKey);
      if (!token) continue;
      try {
        await onEvent(result.record);
        await store.complete(eventKey, token);
        ingested++;
      } catch (error) {
        await store.fail(eventKey, error, token);
        throw error; // never advance past unacknowledged work
      }
    }
  }
  if (newest && newest !== checkpoint) await store.setCheckpoint(checkpointName, newest);
  return { scanned: missed.length, dispatched: ingested, checkpoint: newest ?? checkpoint };
}

/**
 * The injected canonicalResolver must return {state:'finalized'|'orphaned'|'unknown',
 * slot?, evidence?}. A null RPC status is NOT proof of an orphan: only a
 * provider-supported, independently verified orphan verdict is applied.
 */
export async function reconcileConfirmed({
  store, getFinalizedSlot, canonicalResolver, onEvent
}) {
  if (!store?.listConfirmed || !store?.markOrphaned ||
      typeof getFinalizedSlot !== "function" || typeof canonicalResolver !== "function" ||
      typeof onEvent !== "function") {
    throw TypeError("Missing reconciliation capabilities");
  }
  const root = await getFinalizedSlot();
  if (!Number.isSafeInteger(root) || root < 0) throw TypeError("Invalid finalized root slot");
  const counts = { finalized: 0, orphaned: 0, unknown: 0 };
  for (const event of await store.listConfirmed()) {
    if (event.slot == null || event.slot > root) { counts.unknown++; continue; }
    const verdict = await canonicalResolver(event);
    if (verdict?.state === "finalized") {
      const result = await store.put({ ...event, commitment: "finalized", slot: verdict.slot ?? event.slot });
      const token = await store.claim(event.eventKey);
      if (token) {
        try {
          await onEvent(result.record);
          await store.complete(event.eventKey, token);
        } catch (error) {
          await store.fail(event.eventKey, error, token);
          throw error;
        }
      }
      counts.finalized++;
    } else if (verdict?.state === "orphaned") {
      if (typeof verdict.evidence !== "string" || !verdict.evidence) {
        throw Error("Orphan reconciliation requires verifiable evidence");
      }
      if (await store.markOrphaned(event.eventKey, verdict.evidence)) counts.orphaned++;
    } else if (verdict?.state === "unknown") {
      counts.unknown++;
    } else {
      throw TypeError("Unknown canonical verdict");
    }
  }
  return counts;
}
