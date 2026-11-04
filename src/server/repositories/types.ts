import type { Project } from "../../domain/schema";

export type ProjectSummary = Pick<
  Project,
  "id" | "name" | "stage" | "revision" | "updatedAt"
>;
export interface ProjectRepository {
  list(): Promise<ProjectSummary[]>;
  get(id: string): Promise<Project>;
  revision(id: string): Promise<number>;
  /** Publish the complete state only if the expected revision is still current. null means create. */
  save(project: Project, expectedRevision: number | null): Promise<void>;
  putBinary(
    id: string,
    kind: "source" | "png",
    data: Uint8Array,
    mime: string,
  ): Promise<void>;
  getBinary(id: string, kind: "source" | "png"): Promise<Uint8Array>;
}
