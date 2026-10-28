---
name: install-azure-devops-mcp
description: Install and configure Azure DevOps MCP for the CURRENT invoking agent and execution host from its GitHub URL. Detect the client, reuse unambiguous account setup, register through supported controls, and verify tools rather than only installing a CLI plugin.
---

# Configure Azure DevOps MCP for this agent

Source: https://github.com/lawynn/azure-devops-mcp

**Act on an installation request, not just explain the commands.** "Install this
MCP" means configure the client hosting this conversation on its execution host,
not an unrelated CLI. Reading this skill without an installation request is not
permission to change settings. Keep existing registrations and accounts intact.

## 1. Identify the target once

Use the conversation's client/host metadata and exposed tools first. Establish
the invoking client, execution host (local, remote or cloud), requested scope,
and which supported registration controls actually address that client.
An installed `copilot` executable does not prove this is a CLI conversation.
Do not treat a remote shell's home directory as the desktop user's local home.
If the user already named the client/scope, do not ask them again.

Inspect available host-native MCP registration/import capabilities and their
schemas; prefer these over UI automation or files. If tools from this exact
server are already loaded, use `ado_config`/`ado_context` first and avoid a
duplicate installation. Existing `ado`/`azure-devops` tools might be a different
server: verify command/source, not just the display name.

If client/host cannot be established, ask only which client and host this
installation should target. Otherwise select the supported route below and
execute it. Do not make the user choose implementation details already known.

## 2. Prepare only what is missing

Check Node.js 22+ and Git on the **target execution host**. Reuse a verified
existing checkout or installed bundle when safe; inspect its source and actual
files first. Otherwise clone into a stable, user-owned application-data location
on that host, using its documented OS directories. Resolve the real absolute
path. Do not overwrite an existing directory, choose a temporary/session worktree
for persistent registration, or guess a path such as `C:\psrc\azure-devops-mcp`.
Use an argv-based process tool, not interpolated shell commands.

```text
git clone https://github.com/lawynn/azure-devops-mcp.git <absolute-stable-directory>
```

In the verified checkout, run `git rev-parse HEAD` and check
`plugin/server/index.js`, `plugin/server/index.js.sha256`, `plugin/package.json`
and `plugin/mcp.json`. Verify the bundle's SHA-256 against its adjacent digest,
then run the bundle with `--help`. The bundled server needs no npm install,
npx, build, marketplace registration or second source checkout.
`plugin/mcp.json` is the plugin manifest; do not fetch `plugin/.mcp.json`.
Do not upgrade/install missing system prerequisites without authorization.

Use absolute Node and bundle paths for standalone registration, with separate
command/args fields. Keep the checkout in place afterward; it is the runtime.

## 3. Reuse account setup without exposing secrets

Run `<node> <bundle> config validate` using the intended host's existing
`ADO_MCP_CONFIG` or standard external config location. `config show` reports
non-secret profile names/types, allowlists and bindings. It is not a login test.
Do not dump environment values, CLI token caches or credential-store contents.

Reuse a valid config and its scoped providers when the intended target/account
is unambiguous. Infer the target from an explicit user target or the supplied
local repository's ADO origin, not the installer checkout's origin. Never
silently pick another account on ambiguity or authorization failure.

If a binding is missing, add only that binding/profile when the intended
organization, provider and identity are already known; preserve all other
configuration. If those facts cannot be determined safely, ask one focused
question about the missing non-secret account/organization. Do not force a
provider questionnaire when a matching profile already exists.

For genuinely new setup, create only the needed profile and binding in an
external config file; `config init` is optional and creates an **example**, not
working authentication. Default location: `%APPDATA%\azure-devops-mcp\config.json`
on Windows, or `~/.config/azure-devops-mcp/config.json` when APPDATA is unset.
Never overwrite an existing file or register the example organization as ready.

See https://github.com/lawynn/azure-devops-mcp/blob/main/docs/configuration.md.
PAT/bearer/service-secret profiles reference environment-variable **names**,
never secret values. The user/secret manager supplies them to the actual server
process outside chat. Do not pass real credentials through tool arguments,
CLI `--env`, logs or checked-in JSON. Do not assume a GUI-launched app inherits
your shell's environment; use its documented secret/environment mechanism.
An isolated Azure CLI profile can reuse an already-authenticated account only
with its explicit configDir, tenant and optional subscription. No automatic
interactive login, `az account set`, global Git changes or account fallback.
If login/permission is the only blocker, finish safe runtime/registration work
and report that exact remaining prerequisite; do not collect secrets.

## 4. Register in the invoking client

### GitHub Copilot desktop app

Prefer an exposed app-native MCP registration tool when available and permitted.
Use a distinct server identity such as `lawynn-azure-devops` so existing
`ado`/`azure-devops` servers are not replaced.

GitHub documents that repository and Copilot CLI MCP configurations are
automatically available in the app:
https://docs.github.com/en/copilot/how-tos/github-copilot-app/customize-github-copilot-app#configuring-mcp-servers

Therefore the supported `copilot mcp add` route below may configure **shared
user MCP settings**, but only when runtime evidence establishes the same local
OS user, execution host and effective Copilot configuration directory used by
the desktop app, and the requested global scope permits it. Merely finding a
CLI on PATH, a successful disposable test, or installing a CLI plugin is not
that evidence. Do not claim desktop registration from those observations.

If shared scope cannot be established or no supported control is available,
prepare the verified runtime/config and give one precise handoff: in the app,
open **Customize → MCP**, add a custom server using the verified absolute Node
command, separate bundle argument and non-secret `ADO_MCP_CONFIG` path. These
navigation steps are documented; do not invent an "Installed → Add" button,
an unobserved import schema or a nonexistent registration API.

If app UI/configuration access is rejected by built-in safety or organization
policy, **stop registration**. Do not retry the denial, change clients to evade
it, edit desktop databases/internal settings, or use undocumented endpoints.
Report the policy blocker and the same user-operated documented handoff.
Do not require UI automation when an independently authorized, supported
registration API is already available.

### Copilot CLI or positively established shared user configuration

Check `copilot mcp add --help`, `copilot mcp list --json`, and, for an existing
matching name, `copilot mcp get lawynn-azure-devops --json` (never `--show-secrets`).
Use the **invoking client's** effective `COPILOT_HOME`; do not redirect it to a
new home or workspace and mistake that test configuration for installation.
If an identical registration exists, leave it unchanged. If it differs, do not
overwrite it: reuse the proven same server or resolve the naming conflict.

For a verified standalone runtime and real config, execute this argv sequence,
substituting absolute paths (the angle brackets are not literal):

```text
copilot mcp add lawynn-azure-devops --env ADO_MCP_CONFIG=<absolute-config-path> --tools ado_config,ado_context,ado_projects_list,ado_repositories_list,ado_pull_requests_list,ado_pull_request_get,ado_work_item_get,ado_work_items_query,ado_pipelines_list,ado_pipeline_get,ado_pipeline_runs_list,ado_pipeline_run_get -- <absolute-node-executable> <absolute-checkout>/plugin/server/index.js
copilot mcp get lawynn-azure-devops --json
```

Start with read-only/diagnostic tools; retain any existing narrower tool policy.
Enable specific writes only when requested. Preserve unrelated registrations.
`ADO_MCP_CONFIG` is a non-secret path, not credential content.

#### Documented JSON file registration when needed

The CLI command above writes the documented user JSON configuration. Prefer it
when available; **yes, this MCP can be registered as JSON**, not only a plugin.
For explicitly authorized file registration when no supported writer is
available, resolve the invoking host's effective global file:
`<COPILOT_HOME>/mcp-config.json` when set, otherwise the target user's
`~/.copilot/mcp-config.json`. Do not substitute the shell/remote user's home for
the app user's. GitHub documents this file and schema here:
https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-mcp-servers#editing-the-configuration-file

Merge the following entry into the existing `mcpServers` object, replacing the
example paths with **verified absolute paths on the target host**. This is
configuration for Copilot CLI/shared app MCP, not a universal client schema:

```json
{
  "mcpServers": {
    "lawynn-azure-devops": {
      "type": "local",
      "command": "C:\\verified\\node.exe",
      "args": ["C:\\verified\\azure-devops-mcp\\plugin\\server\\index.js"],
      "env": {
        "ADO_MCP_CONFIG": "C:\\verified\\external-config\\config.json"
      },
      "tools": [
        "ado_config", "ado_context", "ado_projects_list", "ado_repositories_list",
        "ado_pull_requests_list", "ado_pull_request_get", "ado_work_item_get",
        "ado_work_items_query", "ado_pipelines_list", "ado_pipeline_get",
        "ado_pipeline_runs_list", "ado_pipeline_run_get"
      ]
    }
  }
}
```

Read/parse locally without echoing any preexisting secrets. Preserve unrelated
top-level keys, servers, environment entries and existing stricter tool policy.
If the exact entry already exists, do nothing. If the name has different
settings, resolve the collision rather than replace it. Invalid existing JSON
is a blocker, not a reason to reset it. Re-read before saving to detect concurrent
changes; write a validated sibling temporary file and atomically replace only
the intended config when the base is unchanged. Do not copy secret-bearing
configuration to logs, public repositories or unprotected backups.

For **explicit project scope**, the documented files are a local `.mcp.json`
at the target project root or shared `.github/mcp.json`. Use the same
`mcpServers` envelope and preserve existing content. Do not create a repository
config for a global request. Project files require folder trust, and local
machine paths should not be committed as portable team defaults. Never treat
`plugin/mcp.json` as the invoking project's config, put MCP settings in
`.github/github-app.yml`, or edit a desktop private database. Direct file
registration is subject to the same host verification and policy boundaries
as the CLI route; it is not a workaround for an app access denial.

If the user specifically requested a **CLI plugin** instead of standalone MCP
registration, `copilot plugin install lawynn/azure-devops-mcp:plugin` is also
supported and bundles the skills. Do not install both routes unnecessarily.
Adding a skill alone does not configure a server.

### Other clients/remote hosts

Use only a documented, available registration mechanism for that specific
client/host. Do not add a local stdio path to a cloud client that cannot execute
it, assume `.vscode/mcp.json` is a Copilot app file, or expose a remote service
without authorization. If unsupported, name the exact limitation and next
client-side action; do not substitute a different client and declare success.

## 5. Verify readiness in this conversation

Check the saved command, args, config path, source and allowed tools through the
client's supported inspection mechanism. Use a host-native reconnect/refresh
only when exposed and permitted. Interactive CLI `/mcp add` documents immediate
loading, but an external `copilot mcp add` subprocess or plugin installation
does **not** prove hot-loading into an already-running conversation.

Look for this registered server's `ado_config` and `ado_context` in the current
agent's tool catalog (use tool discovery if provided). Call them for the intended
target and verify its selected profile. If tools are not present, report
**registered, tools not loaded in this conversation** and give the supported
reconnect action, or ask the user to start a new session in that same client
when no reconnect control is exposed. Never restart their app automatically.
An independent stdio smoke test proves the runtime works, not current-host load.

Only test an authenticated read within the user's authorized target. Do not
create a PR/work item or queue a pipeline to test installation.
Report four facts briefly: **runtime installed; client registered; credentials
ready or blocked; tools loaded here or reconnect required**. Do not say "ready"
because files, a skill, an example config or a CLI plugin merely exist.
