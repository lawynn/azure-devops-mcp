#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";
import { loadConfig, describeConfig, initConfig } from "./config.js";
import { publicError, SafeError } from "./errors.js";

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    await createServer().connect(new StdioServerTransport());
    return;
  }
  if (args.length === 2 && args[0] === "config") {
    if (args[1] === "init") console.log(JSON.stringify(await initConfig()));
    else if (args[1] === "validate" || args[1] === "show") console.log(JSON.stringify(describeConfig(await loadConfig()), null, 2));
    else throw new SafeError("Usage: azure-devops-mcp [config init|validate|show]");
    return;
  }
  if (args.length === 1 && args[0] === "--help") {
    console.log("Azure DevOps MCP (stdio). Usage: azure-devops-mcp [config init|validate|show]\nSet ADO_MCP_CONFIG to an absolute file path. Credentials are configured locally by environment reference.");
    return;
  }
  throw new SafeError("Usage: azure-devops-mcp [config init|validate|show]");
}
main().catch((error: unknown) => {
  console.error(publicError(error));
  process.exitCode = 1;
});
