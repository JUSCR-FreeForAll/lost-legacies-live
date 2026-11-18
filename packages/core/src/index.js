export const portfolioPrinciples = Object.freeze([
  {
    id: "independence",
    title: "Preserve project independence",
    description: "Each product keeps its own repository, deployment, identity, release cycle, and history."
  },
  {
    id: "contracts",
    title: "Integrate through contracts",
    description: "Use versioned APIs, events, schemas, and adapters instead of copying unrelated application code."
  },
  {
    id: "evidence",
    title: "Make status evidence-based",
    description: "Separate committed implementation, reported status, proposals, and unverified assumptions."
  },
  {
    id: "safety",
    title: "Protect people and data",
    description: "Require consent, least privilege, tenant isolation, auditability, and reversible rollout."
  }
]);

export function createProjectReference({ projectId, repositoryUrl, status = "unverified" }) {
  if (typeof projectId !== "string" || !projectId.trim()) {
    throw new TypeError("projectId must be a non-empty string");
  }
  if (typeof repositoryUrl !== "string" || !/^https:\/\//.test(repositoryUrl)) {
    throw new TypeError("repositoryUrl must be an HTTPS URL");
  }
  return Object.freeze({ projectId: projectId.trim(), repositoryUrl, status });
}
