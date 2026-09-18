import { createConfiguredInstallerServer } from "./runtime.ts";
import { fileURLToPath } from "node:url";

const root = process.env.INSTALLER_APP_ROOT?.trim() || fileURLToPath(new URL("../..", import.meta.url));
const { server, config, plan } = await createConfiguredInstallerServer(root);
server.on("error", (error) => { console.error(`INSTALLER_SERVER_ERROR: ${error instanceof Error ? error.message : "unknown"}`); process.exitCode = 1; });
server.listen(config.port, config.host, () => {
  console.log(`INSTALLER_READY mode=${config.mode} port=${config.port} release=${plan.appVersion}`);
});

const shutdown = () => server.close(() => process.exit(0));
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
