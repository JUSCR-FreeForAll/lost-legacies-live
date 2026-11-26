const slug = value => String(value).replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
const jsonSafe = value => JSON.parse(JSON.stringify(value ?? {},
  (_key, field) => typeof field === "bigint" ? field.toString() : field));

export function toCloudEvent(event, { projectId, sourcePrefix = "urn:lost-legacies-live:solana" }) {
  if (!projectId || !event?.programId || !event?.signature || !event?.eventKey) {
    throw TypeError("Project and source event identity required");
  }
  return {
    specversion: "1.0",
    id: event.eventKey,
    source: `${sourcePrefix}:${event.programId}`,
    type: `com.lostlegacies.${projectId}.${slug(event.eventName)}.v1`,
    subject: event.signature,
    time: new Date(event.observedAt ?? Date.now()).toISOString(),
    datacontenttype: "application/json",
    data: {
      project_id: projectId,
      program_id: event.programId,
      signature: event.signature,
      event_index: event.eventIndex,
      slot: event.slot,
      commitment: event.commitment,
      contract_version: "1.0.0",
      provenance: event.provenance ?? null,
      payload: jsonSafe(event.data)
    }
  };
}

function authorizedAdapter({ projectId, deliver, acceptedEvents, authorize, validate }) {
  if (typeof deliver !== "function" || typeof authorize !== "function" ||
      !Array.isArray(acceptedEvents) || acceptedEvents.length === 0) {
    throw TypeError("Explicit event allowlist, delivery and authorization functions required");
  }
  const allowed = new Set(acceptedEvents);
  return async event => {
    if (!allowed.has(event.eventName) || event.commitment !== "finalized") return;
    const cloudEvent = toCloudEvent(event, { projectId });
    if (validate) await validate(cloudEvent);
    // Denial is authoritative. Unavailable authorization must throw to allow retry.
    if (!await authorize(cloudEvent)) return;
    return deliver(cloudEvent);
  };
}

export function createTimeAuctionAdapter({ dispatch, acceptedEvents, authorize, validate }) {
  return authorizedAdapter({ projectId: "timeauction", deliver: dispatch,
    acceptedEvents, authorize, validate });
}

export function createJuscrAdapter({ publish, acceptedEvents, authorize, validate }) {
  return authorizedAdapter({ projectId: "juscr", deliver: publish,
    acceptedEvents, authorize, validate });
}
