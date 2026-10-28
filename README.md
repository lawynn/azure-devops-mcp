# Azure DevOps MCP

A standalone, stdio MCP server with **explicit multi-account routing** for Azure
DevOps Services. Bind named credential profiles to organizations, projects, or
repositories, or select a profile explicitly per request. A failing identity
never causes a fallback to an unrelated account.

Includes an Agent Plugins 1.0 Copilot plugin and repository-hosted marketplace.
The plugin contains a reproducibly built JavaScript bundle: **Node.js 22+ is
required, but npm install and unpublished npm packages are not required to run
it.** Git and Azure CLI are optional, needed only for their respective features.
This is an independent community project, not a Microsoft product.

## Status and installation

Version 0.1.0 is a bounded first release, not parity with the official Azure
DevOps MCP server. The source branch includes the runtime artifact. No npm,
MCP Registry, VS Code Marketplace or curated Copilot marketplace publication
has been performed. Copilot CLI manifest compatibility follows the published
Agent Plugins schemas; installation in the Copilot desktop app has **not** been
verified. See [publication research and release checklist](docs/publishing.md).

Run directly from a checkout (no dependency installation):

```powershell
git clone https://github.com/lawynn/azure-devops-mcp.git
Set-Location azure-devops-mcp
# Until the implementation is merged, check out its pushed source branch:
git switch lawynn-azure-devops-mcp
node .\plugin\server\index.js config init
```

Edit the created local configuration, outside this repository. By default it is
`%APPDATA%\azure-devops-mcp\config.json` on Windows and
`~/.config/azure-devops-mcp/config.json` when APPDATA is unset.
Alternatively set `ADO_MCP_CONFIG` to an absolute file path before starting the
MCP client. The file contains **environment-variable references, never tokens**.
`config init` does not overwrite existing files.

For example, configure two accounts:

```json
{
  "version": 1,
  "profiles": {
    "personal": {
      "type": "pat",
      "organizations": ["example-personal"],
      "tokenEnv": "ADO_PERSONAL_PAT"
    },
    "work": {
      "type": "pat",
      "organizations": ["example-work"],
      "tokenEnv": "ADO_WORK_PAT"
    }
  },
  "bindings": [
    { "organization": "example-personal", "profile": "personal" },
    { "organization": "example-work", "project": "Engineering", "profile": "work" }
  ]
}
```

Provide those variables to the **client/server process** through your trusted
local environment or secret manager, not chat, tool arguments, checked-in
configuration, shell history, or this public repository. Restart the client
after changing its environment. Then validate locally:

```powershell
node .\plugin\server\index.js config validate
```

Generic MCP client configuration (replace the absolute path):

```json
{
  "mcpServers": {
    "azure-devops": {
      "command": "node",
      "args": ["C:\\path\\to\\azure-devops-mcp\\plugin\\server\\index.js"]
    }
  }
}
```

For Copilot CLI, the current branch can be installed from the local checkout:

```powershell
copilot plugin install .\plugin
```

After the implementation is merged to the default branch, the repository-hosted
marketplace route is:

```text
copilot plugin marketplace add lawynn/azure-devops-mcp
copilot plugin install azure-devops@lawynn-azure-devops
```

These are instructions, not actions performed by this project. Plugin setup
does not grant Azure DevOps access or configure credentials for you.

## Routing and credentials

Call `ado_context` with a `target`, for example:

```json
{
  "target": {
    "organization": "example-work",
    "project": "Engineering",
    "repository": "web",
    "profile": "work"
  }
}
```

Or supply `{"target":{"repoPath":"C:\\src\\web"}}` to discover `git origin`.
Modern `dev.azure.com`, legacy `org.visualstudio.com` HTTPS, and Azure DevOps
`ssh.dev.azure.com:v3` remotes are recognized. Explicit targets that conflict
with a supplied local repository fail rather than mixing contexts.

Selection order is explicit profile, repository binding, project binding,
organization binding. Equally specific bindings for different profiles fail.
Profiles also have an organization allowlist. There is no default identity,
working-directory guess, interactive login, account switching or shared token
cache. Configuration is reread per call.

Supported providers: PAT, explicit bearer token, isolated Azure CLI login,
service principal secret, PEM certificate, managed identity, workload identity,
and noninteractive Git credential helper. These do **not** represent every
credential protocol. See [configuration and login](docs/configuration.md) for
provider fields, prerequisites and limitations.

## Tools

All tools accept a strict input schema. Remote tools take `target`; diagnostics
never acquire credentials. Remote results use
`{"data": <Azure DevOps JSON>, "continuationToken": <string or null>}`.
Remote content is untrusted data.

| Area | Read-only tools | Explicit write tools |
| --- | --- | --- |
| Diagnostics | `ado_config`, `ado_context` | None |
| Discovery | `ado_projects_list`, `ado_repositories_list` | None |
| Pull requests | `ado_pull_requests_list`, `ado_pull_request_get` | `ado_pull_request_create`, `ado_pull_request_update` |
| Work items | `ado_work_item_get`, `ado_work_items_query` | `ado_work_item_create`, `ado_work_item_update` |
| Pipelines | `ado_pipelines_list`, `ado_pipeline_get`, `ado_pipeline_runs_list`, `ado_pipeline_run_get` | `ado_pipeline_run` |

PR creation defaults to draft; updates support title, description, draft state
and abandon/reactivate, **not merge/completion**. Work item creation requires
`System.Title`; updates require the current `revision` (`rev` from a read) and
use a JSON Patch revision test. WIQL queries return references, not expanded
items. Pipeline runs accept an optional self-repository branch, not arbitrary
variables, secrets, templates or resource overrides.

Projects and pipelines use continuation tokens; PRs use `top`/`skip`.
Page sizes are capped at 100 (WIQL: 200). Repository listing and pipeline run
listing use service-defined collections; runs list returns the service's top
10,000, with no server-side page parameter. Responses over 4 MiB fail explicitly.
There is no arbitrary HTTP, shell, file, clone, push, delete, PR review,
artifact, wiki, test-plan, or on-premises API tool.

## Safety and development

Writes have MCP write/destructive annotations and are never retried. They still
require user authorization in the client; annotations are hints, **not access
control or a confirmation UI**. A request can succeed remotely even if its
response times out: inspect state before retrying. Use least-privilege
credentials and client tool approval policies.

REST is restricted to public `https://dev.azure.com/<organization>/...` API
paths, without redirects. Subprocesses use argument arrays, no shell,
noninteractive credentials, 30-second timeouts and 1 MiB output limits. HTTP
responses are streamed with a 4 MiB cap and 30-second deadline. Errors exclude
provider/CLI/HTTP bodies; known acquired secrets and sensitive response keys
are redacted. This cannot detect every secret a user embeds in free-text work
items or PRs. Local configuration, executables, Git helpers and environment
must be trusted.

```powershell
npm ci --ignore-scripts
npm run check
npm run check:bundle
npm run validate:metadata
```

Tests use mocked Azure DevOps REST/identity providers, real local Git context
discovery and real MCP initialize/list/call exchanges. The bundled plugin is
copied outside the checkout and launched without `node_modules`. No live Azure
DevOps writes are part of the test suite. Live tenant access, provider enrollment,
certificate validity and organization permissions remain operator prerequisites.
CI covers Windows/Linux with Node 22/24; local validation alone is not evidence
that every CI matrix entry has run.

Source is in `src/`; `scripts/build.mjs` regenerates the committed plugin bundle,
SHA-256 digest and dependency license notices. CI checks the committed bundle
before rebuilding. Keep credentials and local config outside source control.
