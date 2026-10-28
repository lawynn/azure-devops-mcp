import { spawn } from "node:child_process";
import { SafeError } from "./errors.js";

export type Runner = (command: string, args: string[], options?: {
  env?: NodeJS.ProcessEnv; input?: string;
}) => Promise<string>;

export const run: Runner = (command, args, options = {}) => new Promise((resolve, reject) => {
  const child = spawn(command, args, {
    shell: false, windowsHide: true, env: options.env ?? process.env, stdio: ["pipe", "pipe", "pipe"],
  });
  const chunks: Buffer[] = [];
  let size = 0;
  let failed = false;
  const fail = () => {
    failed = true;
    child.kill();
    reject(new SafeError("Credential/context command failed, timed out or exceeded its output limit. Complete login/setup outside MCP and check the selected profile."));
  };
  const timer = setTimeout(fail, 30_000);
  for (const stream of [child.stdout, child.stderr]) {
    stream.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > 1024 * 1024) fail();
      else if (stream === child.stdout) chunks.push(chunk);
    });
  }
  child.on("error", fail);
  child.stdin.on("error", fail);
  child.on("close", (code) => {
    clearTimeout(timer);
    if (failed) return;
    if (code !== 0) fail();
    else resolve(Buffer.concat(chunks).toString("utf8").trim());
  });
  child.stdin.end(options.input);
});
