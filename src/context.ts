import { realpath } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { z } from "zod";
import { orgName, segment, type Config } from "./config.js";
import { SafeError } from "./errors.js";
import { run, type Runner } from "./process.js";

export const targetSchema = z.strictObject({
  organization: z.string().max(512).optional(),
  project: segment.optional(),
  repository: segment.optional(),
  repoPath: z.string().max(4096).optional(),
  profile: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/).optional(),
});
export type Target = z.infer<typeof targetSchema>;
export type RepoContext = { organization: string; project: string; repository: string };
export type Context = {
  organization: string; project?: string; repository?: string; repoPath?: string; profile: string;
};

function decodeSegment(value: string) {
  try { return segment.parse(decodeURIComponent(value)); }
  catch { throw new SafeError("Invalid Azure DevOps remote path."); }
}

function validateUrlText(value: string) {
  if (/[\u0000-\u0020\u007f\\]/u.test(value) ||
      /(?:^|\/)(?:\.|%2e){1,2}(?:\/|$|[?#])/i.test(value)) {
    throw new SafeError("Invalid or traversing Azure DevOps URL.");
  }
}

export function parseRemote(remote: string): RepoContext {
  validateUrlText(remote);
  let org: string | undefined, project: string | undefined, repo: string | undefined;
  const ssh = /^(?:git@ssh\.dev\.azure\.com:v3\/|ssh:\/\/git@ssh\.dev\.azure\.com\/v3\/)([^/]+)\/([^/]+)\/([^/]+)$/i.exec(remote);
  if (ssh) [, org, project, repo] = ssh;
  else {
    let url: URL;
    try { url = new URL(remote); } catch { throw new SafeError("Unsupported Azure DevOps remote."); }
    if (url.protocol !== "https:" || url.port || url.password || url.search || url.hash) throw new SafeError("Unsupported or credential-bearing Azure DevOps remote.");
    const parts = url.pathname.split("/").filter(Boolean);
    if (url.hostname === "dev.azure.com" && parts.length === 4 && parts[2] === "_git") {
      [org, project, , repo] = parts;
    } else if (/^[a-z0-9-]+\.visualstudio\.com$/i.test(url.hostname)) {
      org = url.hostname.split(".")[0];
      if (parts.length === 3 && parts[1] === "_git") [project, , repo] = parts;
      else if (parts.length === 4 && parts[0] === "DefaultCollection" && parts[2] === "_git") [, project, , repo] = parts;
    }
  }
  if (!org || !project || !repo) throw new SafeError("Remote must identify an Azure DevOps Services organization, project and repository.");
  const parsedOrg = orgName.safeParse(org);
  if (!parsedOrg.success) throw new SafeError("Invalid Azure DevOps organization.");
  return { organization: parsedOrg.data, project: decodeSegment(project), repository: decodeSegment(repo) };
}

export function normalizeOrganization(input: string): string {
  validateUrlText(input);
  if (/^[a-zA-Z0-9-]+$/.test(input)) {
    const org = orgName.safeParse(input);
    if (org.success) return org.data;
  }
  let url: URL;
  try { url = new URL(input); } catch { throw new SafeError("Expected an organization name or Azure DevOps Services organization URL."); }
  if (url.protocol !== "https:" || url.port || url.username || url.password || url.search || url.hash) throw new SafeError("Invalid organization URL.");
  const parts = url.pathname.split("/").filter(Boolean);
  if (url.hostname === "dev.azure.com" && parts.length === 1) return normalizeOrganization(parts[0]!);
  if (/^[a-z0-9-]+\.visualstudio\.com$/i.test(url.hostname) && parts.length === 0) return normalizeOrganization(url.hostname.split(".")[0]!);
  throw new SafeError("Only public Azure DevOps Services organization URLs are supported.");
}

export async function localRepo(path: string, runner: Runner = run) {
  if (!isAbsolute(path) || /[\u0000-\u001f]/u.test(path)) throw new SafeError("repoPath must be an absolute local repository path.");
  let resolved: string;
  try { resolved = await realpath(path); } catch { throw new SafeError("Local repository path is unavailable."); }
  const remote = await runner("git", ["-C", resolved, "remote", "get-url", "origin"]);
  return { ...parseRemote(remote), repoPath: resolved };
}

export async function resolveContext(config: Config, input: Target, runner: Runner = run): Promise<Context> {
  const inferred = input.repoPath ? await localRepo(input.repoPath, runner) : undefined;
  const explicitOrg = input.organization ? normalizeOrganization(input.organization) : undefined;
  if (inferred && (
    (explicitOrg && explicitOrg !== inferred.organization) ||
    (input.project && input.project.toLowerCase() !== inferred.project.toLowerCase()) ||
    (input.repository && input.repository.toLowerCase() !== inferred.repository.toLowerCase())
  )) throw new SafeError("Explicit target conflicts with repoPath origin. Omit repoPath to target a different repository.");
  const organization = explicitOrg ?? inferred?.organization;
  if (!organization) throw new SafeError("Supply organization or repoPath; the server does not guess from its working directory.");
  const project = input.project ?? inferred?.project;
  const repository = input.repository ?? inferred?.repository;
  if (repository && !project) throw new SafeError("A repository target requires a project.");
  let profile = input.profile;
  if (!profile) {
    const matches = config.bindings.filter((b) =>
      b.organization === organization &&
      (!b.project || b.project.toLowerCase() === project?.toLowerCase()) &&
      (!b.repository || b.repository.toLowerCase() === repository?.toLowerCase()));
    const score = (b: Config["bindings"][number]) => b.repository ? 3 : b.project ? 2 : 1;
    const best = Math.max(0, ...matches.map(score));
    const names = new Set(matches.filter((b) => score(b) === best).map((b) => b.profile));
    if (names.size !== 1) throw new SafeError("No unique credential binding. Supply an explicit profile or fix equally specific bindings.");
    profile = [...names][0]!;
  }
  const selected = config.profiles[profile];
  if (!selected || !selected.organizations.includes(organization)) throw new SafeError("Selected credential profile is missing or not allowed for this organization.");
  return {
    organization, profile,
    ...(project ? { project } : {}), ...(repository ? { repository } : {}),
    ...(inferred ? { repoPath: inferred.repoPath } : {}),
  };
}
