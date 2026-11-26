const COMMITMENTS = new Map([[1, "confirmed"], [2, "finalized"]]);
export const formatEventKey = ({ programId, signature, eventIndex }) => {
  if (!programId || !signature || !Number.isInteger(eventIndex) || eventIndex < 0) throw TypeError("Invalid event identity");
  return `${programId}:${signature}:${eventIndex}`;
};
const copy = value => value ? { ...value } : null;

export class MemoryEventStore {
  #events = new Map();
  #checkpoints = new Map();
  #transitions = [];
  async put(event) {
    const old = this.#events.get(event.eventKey);
    if (!old) {
      const record = { ...event, status: "pending", attempts: 0, lastError: null };
      this.#events.set(event.eventKey, record);
      return { record: copy(record), inserted: true, upgraded: false };
    }
    if (old.status === "orphaned") throw Error("Cannot silently resurrect an orphaned event");
    const upgraded = old.commitment === "confirmed" && event.commitment === "finalized";
    if (upgraded) {
      old.commitment = "finalized";
      old.slot = event.slot ?? old.slot;
      this.#transitions.push({ eventKey: event.eventKey, transition: "finalized", at: Date.now() });
    }
    return { record: copy(old), inserted: false, upgraded };
  }
  async claim(key) {
    const e = this.#events.get(key);
    if (!e || ["processing", "processed", "orphaned"].includes(e.status)) return false;
    e.status = "processing";
    e.attempts++;
    return e.attempts;
  }
  async complete(key, token) {
    const e = this.#events.get(key);
    if (!e || e.status !== "processing" || token !== e.attempts) throw Error("Cannot complete unclaimed event");
    e.status = "processed";
    e.lastError = null;
  }
  async fail(key, error, token) {
    const e = this.#events.get(key);
    if (!e || e.status !== "processing" || token !== e.attempts) throw Error("Cannot fail unclaimed event");
    e.status = "failed";
    e.lastError = String(error?.message ?? error).slice(0, 2000);
  }
  async listPending({ commitment } = {}) {
    return [...this.#events.values()].filter(e =>
      ["pending", "failed"].includes(e.status) && (!commitment || e.commitment === commitment)).map(copy);
  }
  async listConfirmed() {
    return [...this.#events.values()].filter(e => e.commitment === "confirmed" && e.status !== "orphaned").map(copy);
  }
  async markOrphaned(key, evidence) {
    if (typeof evidence !== "string" || !evidence) throw TypeError("Orphan evidence required");
    const e = this.#events.get(key);
    if (!e || e.commitment !== "confirmed" || e.status === "processing") return false;
    e.status = "orphaned";
    this.#transitions.push({ eventKey: key, transition: "orphaned", evidence, at: Date.now() });
    return true;
  }
  async get(key) { return copy(this.#events.get(key)); }
  async getCheckpoint(key) { return this.#checkpoints.get(key) ?? null; }
  async setCheckpoint(key, signature) { this.#checkpoints.set(key, signature); }
  async listTransitions() { return this.#transitions.map(copy); }
}

/**
 * The host provides an Anchor EventParser, version provenance, WebSocket, and store.
 * Confirmed notifications are stored provisionally, but only finalized notifications
 * reach onEvent by default. Backfill must be independently configured by the host.
 */
export function startDualCommitmentListener(c) {
  if (!c?.wsUrl || !c.programId || !c.store || !c.createWebSocket ||
      !c.createEventParser || typeof c.onEvent !== "function") throw TypeError("Missing listener configuration");
  if (!["anchorVersion", "parserVersion", "idlVersion"].every(k =>
    typeof c.provenance?.[k] === "string" && c.provenance[k].trim())) {
    throw TypeError("Anchor, parser and IDL version provenance required");
  }
  const parser = c.createEventParser(c.programId, c.idl);
  if (typeof parser?.parseLogs !== "function") throw TypeError("Invalid event parser");
  const log = c.logger ?? console;
  let ws = null, generation = 0, ping = null, reconnect = null;
  let retries = 0, stopped = false, queue = Promise.resolve();
  const subscriptions = new Map();
  const dispatch = async event => {
    const token = await c.store.claim(event.eventKey);
    if (!token) return;
    try {
      await c.onEvent(event);
      await c.store.complete(event.eventKey, token);
    } catch (error) {
      await c.store.fail(event.eventKey, error, token);
      log.error?.("[solana-event-handler]", event.eventKey, error);
    }
  };
  const accept = async event => {
    const result = await c.store.put(event);
    if (result.upgraded) await c.onCommitmentUpgrade?.({ ...result.record, previousCommitment: "confirmed" });
    if (event.commitment === "confirmed") {
      if (result.inserted) await c.onProvisionalObservation?.(result.record);
      if (!c.allowConfirmedDelivery) return;
    }
    await dispatch(result.record);
  };
  const retryPending = async () => {
    for (const event of await c.store.listPending({
      commitment: c.allowConfirmedDelivery ? undefined : "finalized"
    })) {
      if (stopped) return;
      await dispatch(event);
    }
  };
  const notify = async (params, socketGeneration) => {
    if (stopped || generation !== socketGeneration) return;
    const commitment = subscriptions.get(params?.subscription);
    if (!commitment) { log.warn?.("Unknown Solana subscription", params?.subscription); return; }
    const r = params?.result, signature = r?.value?.signature, logs = r?.value?.logs;
    if (!signature || r?.value?.err != null || !Array.isArray(logs)) return;
    let index = 0;
    for (const parsed of parser.parseLogs(logs)) {
      if (stopped || generation !== socketGeneration) return;
      const eventIndex = index++;
      await accept({
        eventKey: formatEventKey({ programId: c.programId, signature, eventIndex }),
        programId: c.programId, signature, eventIndex, eventName: parsed.name,
        data: parsed.data ?? {}, slot: r?.context?.slot ?? null, commitment,
        provenance: { ...c.provenance }, observedAt: Date.now()
      });
    }
  };
  const connect = () => {
    if (stopped) return;
    const socketGeneration = ++generation;
    subscriptions.clear();
    const socket = c.createWebSocket(c.wsUrl);
    ws = socket;
    socket.on("open", () => {
      if (stopped || generation !== socketGeneration) return;
      retries = 0;
      ping = setInterval(() => { if (socket.readyState === 1) socket.ping?.(); }, c.pingIntervalMs ?? 30000);
      for (const [id, commitment] of COMMITMENTS) {
        socket.send(JSON.stringify({ jsonrpc: "2.0", id, method: "logsSubscribe",
          params: [{ mentions: [c.programId] }, { commitment }] }));
      }
      queue = queue.then(retryPending)
        .then(() => c.onHistoryCatchUp?.({ reconnect: socketGeneration > 1 }))
        .catch(e => log.error?.("[solana-history-recovery]", e));
      if (socketGeneration > 1) queue = queue.then(() => c.onReconnect?.())
        .catch(e => log.error?.("[solana-reconnect]", e));
    });
    socket.on("message", raw => {
      if (stopped || generation !== socketGeneration) return;
      let message;
      try { message = JSON.parse(raw.toString()); } catch { return; }
      if (typeof message.id === "number" && typeof message.result === "number") {
        const level = COMMITMENTS.get(message.id);
        if (level) subscriptions.set(message.result, level);
        return;
      }
      if (message.method === "logsNotification") queue = queue
        .then(() => notify(message.params, socketGeneration))
        .catch(e => log.error?.("[solana-event-notification]", e));
    });
    socket.on("close", () => {
      if (ping) clearInterval(ping);
      ping = null;
      if (stopped || generation !== socketGeneration || reconnect) return;
      const delay = Math.min(c.maxReconnectDelayMs ?? 30000, 1000 * 2 ** retries++);
      reconnect = setTimeout(() => { reconnect = null; connect(); },
        Math.floor(delay * (0.75 + Math.random() * 0.5)));
    });
    socket.on("error", error => log.error?.("[solana-ws]", error?.message ?? error));
  };
  connect();
  return {
    stop() {
      if (stopped) return;
      stopped = true;
      if (ping) clearInterval(ping);
      if (reconnect) clearTimeout(reconnect);
      if (ws?.readyState === 1) {
        let id = 100;
        for (const sub of subscriptions.keys()) ws.send(JSON.stringify({
          jsonrpc: "2.0", id: id++, method: "logsUnsubscribe", params: [sub]
        }));
      }
      ws?.close?.();
      subscriptions.clear();
    },
    waitForIdle() { return queue; },
    getState() { return { stopped, retryCount: retries, activeSubscriptions: subscriptions.size,
      socketReadyState: ws?.readyState ?? null }; }
  };
}
