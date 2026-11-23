import { handleProjectRequest, type ProjectRequest } from "./projectFileWorker.ts";

async function reply(request: ProjectRequest): Promise<void> {
  const { response, transfer } = await handleProjectRequest(request);
  postMessage(response, { transfer });
}

addEventListener("message", (event: MessageEvent<ProjectRequest>) => {
  void reply(event.data);
});
