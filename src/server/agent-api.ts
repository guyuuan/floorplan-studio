import { z } from "zod";
import { batchSchema } from "../domain/schema";
import { RuleError } from "../domain/engine";
import { inspectImage, type ProjectService } from "./store";
export function createAgentApi(service: ProjectService) {
  return async (path: string, body?: unknown): Promise<any> => {
    const segments = path.split("/").map(decodeURIComponent);
    if (segments[0] !== "projects")
      throw new RuleError("NOT_FOUND", "接口不存在。", 404);
    if (!body) {
      if (segments.length === 1) return service.listProjects();
      if (segments.length === 2) {
        const {
          history: _,
          future: __,
          ...rest
        } = await service.getProject(segments[1]);
        return rest;
      }
      if (segments.length === 3 && segments[2] === "source") {
        const s = await service.sourceImage(segments[1]);
        return { ...s.meta, data: Buffer.from(s.data).toString("base64") };
      }
      if (segments.length === 3 && segments[2] === "export")
        return service.exportProject(segments[1]);
    } else {
      if (segments.length === 1) {
        const data = z
          .object({
            name: z.string().min(1).max(80),
            imageBase64: z.string().max(14000000),
            imageName: z.string().max(150).default("floorplan.png"),
          })
          .parse(body);
        const source = await inspectImage(
          Buffer.from(data.imageBase64, "base64"),
          data.imageName,
        );
        const project = await service.createProject(data.name, source);
        return {
          id: project.id,
          name: project.name,
          revision: project.revision,
          stage: project.stage,
        };
      }
      if (segments.length === 3 && segments[2] === "commands") {
        const batch = batchSchema.parse(body);
        const {
          history: _,
          future: __,
          ...rest
        } = await service.mutateProject(
          segments[1],
          batch.expectedRevision,
          batch.commands,
          "agent",
        );
        return rest;
      }
    }
    throw new RuleError("NOT_FOUND", "接口不存在。", 404);
  };
}
