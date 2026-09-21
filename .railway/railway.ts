import { defineRailway, project, service } from "railway/iac";

// Last resort for a per-service CaC repo. Prefer one .railway file for the
// project and drop this if you later combine services into that file.
export const partial = "amble";

export default defineRailway(() => {
  const amble = service("amble", {
    start: "node server.js",
    healthcheck: "/api/health",
    healthcheckTimeout: 60,
    replicas: 1,
    // dockerfilePath from CaC: "Dockerfile"
    // builder from CaC: "DOCKERFILE"
  });
  return project("amble-agent", {
    resources: [amble],
  });
});
