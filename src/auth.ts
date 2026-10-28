import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";
import {
  ClientCertificateCredential, ClientSecretCredential, ManagedIdentityCredential, WorkloadIdentityCredential,
} from "@azure/identity";
import type { Config, Profile } from "./config.js";
import { localRepo, type Context } from "./context.js";
import { SafeError } from "./errors.js";
import { run, type Runner } from "./process.js";

export const ADO_RESOURCE = "499b84ac-1321-427f-aa17-267ca6975798";
export const ADO_SCOPE = `${ADO_RESOURCE}/.default`;
export type Credential = { authorization: string; secrets: string[] };
export type CredentialProvider = (profile: Profile, context: Context) => Promise<Credential>;
export type IdentityFactory = (profile: Profile) => Pick<ClientSecretCredential, "getToken">;

function envSecret(name: string): string {
  const value = process.env[name];
  if (!value || /[\u0000-\u0020\u007f]/u.test(value)) throw new SafeError("Credential environment variable is missing or malformed. Set it in the server process, not in MCP arguments.");
  return value;
}

const identityFactory: IdentityFactory = (profile) => {
  const options = { retryOptions: { maxRetries: 0 }, disableInstanceDiscovery: false };
  switch (profile.type) {
    case "client-secret":
      return new ClientSecretCredential(profile.tenantId, profile.clientId, envSecret(profile.secretEnv), options);
    case "client-certificate":
      return new ClientCertificateCredential(profile.tenantId, profile.clientId, profile.certificatePath, options);
    case "managed-identity":
      return new ManagedIdentityCredential({ ...options, ...(profile.clientId ? { clientId: profile.clientId } : {}) });
    case "workload-identity":
      return new WorkloadIdentityCredential({
        ...options, tenantId: profile.tenantId, clientId: profile.clientId, tokenFilePath: profile.tokenFilePath,
      });
    default: throw new SafeError("Profile is not an Azure Identity provider.");
  }
};

function azureCommand(profile: Extract<Profile, { type: "azure-cli" }>): { command: string; prefix: string[] } {
  if (process.platform !== "win32") return { command: "az", prefix: [] };
  // az.cmd requires a shell on Windows. Invoke the installed CLI's Python module
  // instead, keeping every argument separate and avoiding cmd.exe interpolation.
  if (profile.pythonPath) return { command: profile.pythonPath, prefix: ["-I", "-m", "azure.cli"] };
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    if (!dir) continue;
    if (existsSync(join(dir, "az.exe"))) return { command: join(dir, "az.exe"), prefix: [] };
    const python = join(dir, "..", "python.exe");
    if (existsSync(join(dir, "az.cmd")) && existsSync(python)) return { command: python, prefix: ["-I", "-m", "azure.cli"] };
  }
  throw new SafeError("Azure CLI executable unavailable. Install Azure CLI; on Windows set the profile's pythonPath to its bundled python.exe if needed.");
}

function credential(token: string, type: "pat" | "bearer", username = ""): Credential {
  if (!token || /[\u0000-\u0020\u007f]/u.test(token)) throw new SafeError("Credential provider returned a missing or malformed token.");
  const encoded = Buffer.from(`${username}:${token}`).toString("base64");
  return {
    authorization: type === "pat" ? `Basic ${encoded}` : `Bearer ${token}`,
    secrets: [token, encoded, encodeURIComponent(token)],
  };
}

export function createCredentialProvider(runner: Runner = run, factory: IdentityFactory = identityFactory): CredentialProvider {
  return async (profile, context) => {
    try {
      if (!profile.organizations.includes(context.organization)) throw new SafeError("Credential profile does not allow this organization.");
      switch (profile.type) {
        case "pat": case "bearer":
          return credential(envSecret(profile.tokenEnv), profile.type);
        case "azure-cli": {
          const { command, prefix } = azureCommand(profile);
          const args = [...prefix, "account", "get-access-token", "--resource", ADO_RESOURCE,
            "--tenant", profile.tenant, "--output", "json", "--only-show-errors"];
          if (profile.subscription) args.push("--subscription", profile.subscription);
          const output = await runner(command, args, {
            env: { ...process.env, AZURE_CONFIG_DIR: profile.configDir, AZURE_CORE_NO_COLOR: "true" },
          });
          const result: unknown = JSON.parse(output);
          if (!result || typeof result !== "object" || !("accessToken" in result) || typeof result.accessToken !== "string") {
            throw new SafeError("Azure CLI returned no access token.");
          }
          return credential(result.accessToken, "bearer");
        }
        case "git-helper": {
          if (!context.repoPath || !context.project || !context.repository) throw new SafeError("git-helper requires repoPath and a matching Azure DevOps origin.");
          const repo = await localRepo(context.repoPath, runner);
          if (repo.organization !== context.organization || repo.project.toLowerCase() !== context.project.toLowerCase() ||
              repo.repository.toLowerCase() !== context.repository.toLowerCase()) {
            throw new SafeError("Git origin changed or does not match the selected target.");
          }
          const path = [repo.organization, repo.project, "_git", repo.repository].map(encodeURIComponent).join("/");
          const output = await runner("git", [
            "-C", repo.repoPath, "-c", "credential.interactive=false", "-c", "credential.useHttpPath=true",
            "-c", "core.askPass=", "credential", "fill",
          ], {
            env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "never", GCM_GUI_PROMPT: "0", GIT_ASKPASS: "", SSH_ASKPASS: "" },
            input: `protocol=https\nhost=dev.azure.com\npath=${path}\nusername=${profile.username}\n\n`,
          });
          const fields = new Map(output.split(/\r?\n/).map((line) => {
            const i = line.indexOf("=");
            return [line.slice(0, i), line.slice(i + 1)];
          }));
          if (fields.get("username") !== profile.username || !fields.get("password")) throw new SafeError("Git helper did not return credentials for the configured username.");
          if ((fields.has("host") && fields.get("host") !== "dev.azure.com") ||
              (fields.has("path") && fields.get("path") !== path)) throw new SafeError("Git helper returned a different credential scope.");
          return credential(fields.get("password")!, "pat", profile.username);
        }
        default: {
          const identity = factory(profile);
          const signal = AbortSignal.timeout(30_000);
          const token = await Promise.race([
            identity.getToken(ADO_SCOPE, { abortSignal: signal }),
            new Promise<never>((_, reject) => {
              signal.addEventListener("abort", () => reject(new SafeError("Identity token acquisition timed out.")), { once: true });
            }),
          ]);
          if (!token || token.expiresOnTimestamp <= Date.now()) throw new SafeError("Identity provider returned no valid access token.");
          return credential(token.token, "bearer");
        }
      }
    } catch (error) {
      if (error instanceof SafeError) throw error;
      throw new SafeError("Selected credential provider failed. Verify its explicit login, tenant, identity and organization permissions outside MCP. No fallback was attempted.");
    }
  };
}

export function profileFor(config: Config, context: Context): Profile {
  const profile = config.profiles[context.profile];
  if (!profile) throw new SafeError("Credential profile no longer exists.");
  return profile;
}
