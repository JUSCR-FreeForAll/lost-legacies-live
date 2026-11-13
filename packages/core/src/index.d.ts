export interface ProjectReference {
  projectId: string;
  repositoryUrl: string;
  status: "implemented" | "reported" | "proposed" | "unverified";
}

export interface PortfolioPrinciple {
  id: string;
  title: string;
  description: string;
}

export declare const portfolioPrinciples: readonly PortfolioPrinciple[];

export declare function createProjectReference(input: {
  projectId: string;
  repositoryUrl: string;
  status?: ProjectReference["status"];
}): Readonly<ProjectReference>;
