# Distribution and publication research

Reviewed against first-party documentation on **2026-10-28**. The public `main`
branch publishes this repository's Copilot marketplace catalog. npm/MCP Registry
publication and curated listing are separate operator actions, not automatic
consequences of a push/tag. No registry identities, curated submissions or
installations into the user's normal Copilot configuration are created here.

## 1. Copilot plugin: available repository-hosted route

GitHub documents Agent Plugins 1.0 with root `plugin.json`, root `mcp.json`
and portable `skills/<name>/SKILL.md`. This project places that root at
`plugin/`, using the canonical
[plugin schema](https://agent-plugins.org/schemas/1.0.0/plugin.schema.json)
and [MCP schema](https://agent-plugins.org/schemas/1.0.0/mcp.schema.json).

The stdio definition runs Node with `${PLUGIN_ROOT}/server/index.js` and cwd
`${PLUGIN_ROOT}`. The committed bundle contains runtime dependencies and
third-party license notices. Its launcher is exercised from an isolated
directory without `node_modules`; no `npx` lookup of an unpublished package
is needed. Runtime requires Node 22+, plus operator configuration/login.
The plugin intentionally does not write into its cache or assume that cwd is
the user's repository. Config is stored in the user's external config directory.

`.github/plugin/marketplace.json` hosts a marketplace named
`lawynn-azure-devops` and a plugin named `azure-devops` sourced from `./plugin`.
The catalog and bundled plugin are available on the default branch:

```text
copilot plugin marketplace add lawynn/azure-devops-mcp
copilot plugin install azure-devops@lawynn-azure-devops
```

Alternatively install directly from GitHub without registering any marketplace:

```text
copilot plugin install lawynn/azure-devops-mcp:plugin
```

The documented GitHub subdirectory syntax is `OWNER/REPO:PATH`; the suffix is
necessary because this repository's root is not its plugin root. Both install
routes select `plugin/`, containing `plugin.json`, `mcp.json`, the bundled
`server/index.js`, dependency notices and two standard `skills/<name>/SKILL.md`
directories. Copilot caches remote plugins; use `copilot plugin update azure-devops`
to check for upstream changes. Reinstall a changed local plugin to refresh it.

The [installation skill](../plugin/skills/install-azure-devops-mcp/SKILL.md) is
linked from the repository README so an agent given only the repository URL
can discover onboarding instructions before plugin installation. An agent
does not need to register a marketplace first. Copilot CLI also supports
adding the guide alone from its raw HTTPS file:

```text
copilot skill add https://raw.githubusercontent.com/lawynn/azure-devops-mcp/main/plugin/skills/install-azure-devops-mcp/SKILL.md
```

That installs only a personal skill, not the plugin/server. For an explicitly
requested project-scoped skill, the documented `copilot skill add --project`
option writes under the current project's `.github/skills/`. The full plugin
already bundles the guide, so a separate skill installation is optional.

**This is a self-hosted Git repository marketplace**, not acceptance into a
built-in/curated marketplace. Being public is sufficient to host the manifest,
not evidence of endorsement, discoverability or compatibility in every client.
Copilot desktop support is unverified; CLI documentation must not be presented
as a guarantee for that app. The generic stdio MCP configuration is a separate
route, not proof of compatibility with every client's plugin mechanism.

### Installation validation

`npm run smoke:install -- --local` exercises local plugin, local repository
marketplace and standalone skill-file installation. `npm run smoke:install`
exercises the direct GitHub plugin, public repository marketplace and raw HTTPS
skill routes against `main`. Every scenario has its own disposable
`COPILOT_HOME`, HOME/USERPROFILE and account configuration. The script omits
credentials from child environments, disables CLI auto-update, checks for no
preexisting non-builtin plugins, and deletes its temporary directories afterward.
It reuses the already-installed CLI executable/cache, not the user's settings.
No agent session, paid model call or Azure DevOps request is made.

For each plugin route, it checks that both skills are discoverable, verifies
the installed runtime against this checkout's SHA-256, initializes the actual
MCP server, lists 17 tools and calls `ado_context` with fake account metadata.
Standalone skill installation must not install a plugin. Local
directory-sourced marketplaces load their source files live rather than
creating an installed-plugin copy; the script handles this documented behavior.

Both local routes and all three **public GitHub `main` routes** (direct
subdirectory plugin, repository marketplace plugin and raw HTTPS standalone
skill) were exercised successfully on Windows on 2026-10-28 with Copilot CLI
`1.0.102-0.unstable.r40141230562.g130d689`. Each plugin install resolved the
bundled runtime, exposed both skills and passed the initialize/list/call check.
Other CLI versions are documented support, not an exercised compatibility
matrix; the server's own CI tests cover Windows/Linux on Node 22/24 separately.

On Windows, disabling auto-update can select an older built-in CLI rather than
a newer already-cached version. For a known compatible version already installed,
the smoke script accepts an explicit cache selector:

```powershell
$env:COPILOT_SMOKE_VERSION = '1.0.102-0.unstable.r40141230562.g130d689'
npm run smoke:install -- --local
npm run smoke:install
```

This selector is for reproducible validation, not a command to install or
upgrade Copilot. If the required plugin/skill commands are unavailable, install
a compatible CLI through your normal approved setup process, rather than
weakening policy or modifying the running desktop app.

### Current-client registration and readiness

The initial installation skill was incorrectly CLI-first: an installation
attempt from a Copilot desktop chat reached a built-in safety-policy denial
while inspecting the app UI and made no configuration changes. Neither an
unverified source path nor a guessed "Installed → Add" UI action was a usable
installation path. `plugin/mcp.json` existed; a lookup of `plugin/.mcp.json`
was simply the wrong filename.

The updated skill targets the **invoking client, execution host and requested
scope** first. An installed CLI is not evidence that the conversation runs in
that CLI. It prefers supported host-native registration controls, verifies
absolute persistent runtime paths, reuses unambiguous scoped account setup,
preserves unrelated registrations and uses a distinct standalone registration
name, `lawynn-azure-devops`. New standalone registrations start with diagnostic
and read-only tools rather than enabling writes by default.

GitHub's [app customization documentation](https://docs.github.com/en/copilot/how-tos/github-copilot-app/customize-github-copilot-app#configuring-mcp-servers)
explicitly states that repository and CLI MCP configurations are automatically
available in the desktop app. The documented CLI `copilot mcp add` command is
therefore a possible shared-user registration route **only when the app and
CLI demonstrably use the same OS user, execution host and configuration scope**.
It is not a universal desktop installation API. The implementation tests its
configuration behavior in disposable CLI homes, not a real desktop installation.

The same documentation provides the user-operated desktop route:
**Customize → MCP → add a custom server**, then follow the actual prompts.
The skill uses this precise handoff if no supported automatic control can target
the current host. A policy denial must not be bypassed with CLI changes, database
edits, hidden endpoints or alternative UI automation. No desktop UI action is
attempted as part of this improvement's tests.

For direct JSON registration, the supported global file is
`<COPILOT_HOME>/mcp-config.json`, defaulting to `~/.copilot/mcp-config.json`;
project-scoped options are `.mcp.json` or `.github/mcp.json`. The skill includes
the documented `mcpServers` envelope with a `local` server, absolute command
and args, a non-secret `ADO_MCP_CONFIG` path and explicit read-only tools.
It prefers the supported CLI writer, otherwise prescribes a validated,
concurrency-checked atomic merge without overwriting existing keys/servers.
No new installer writes internal app storage.

The disposable CLI smoke test now exercises that writer independently of
plugin installation: it seeds existing `ado`/`azure-devops` registrations,
adds `lawynn-azure-devops`, checks preservation, skips an identical registration,
refuses a conflicting one and verifies another configuration home is unaffected.
It then launches the saved standalone runtime for an actual MCP protocol check.
Those are isolated CLI/configuration checks, not proof the user's desktop
shares that directory or loaded tools in the current conversation.

Registration is not tool loading: the CLI's **interactive** `/mcp add` flow
documents immediate availability, but an external registration subprocess does
not demonstrate a live desktop/CLI conversation has reconnected. The skill
checks the current agent's tool catalog and calls `ado_config`/`ado_context`
when present. With no supported reconnect control, it reports registration
separately and requests a new session in that same client. Runtime smoke tests,
saved configuration, credential setup and current-conversation tool calls are
four distinct evidence levels, never interchangeable.

Actual authentication still requires a valid intended profile and organization
permissions. No secrets are accepted in chat/installer arguments, and no
interactive login is triggered. A GUI process is not assumed to inherit the
installer shell's environment. An existing explicit Azure CLI profile can
avoid token environment plumbing when its identity is already established;
it must not silently select a different cached account.

Sources:

- [App MCP configuration and documented custom-server UI](https://docs.github.com/en/copilot/how-tos/github-copilot-app/customize-github-copilot-app#configuring-mcp-servers)
- [Supported CLI user MCP registration and interactive reload behavior](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-mcp-servers)
- [CLI configuration directory and COPILOT_HOME](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-config-dir-reference)

Sources:

- [Creating a plugin for Copilot CLI](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/plugins-creating)
- [Creating a plugin marketplace](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/plugins-marketplace)
- [CLI plugin command/manifest reference](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-plugin-reference)
- [CLI standalone skill commands](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference#managing-skills-non-interactively)
- [COPILOT_HOME and CLI configuration scope](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-config-dir-reference)

### Curated discoverability: separate review required

The current CLI documentation identifies `awesome-copilot` as a built-in
marketplace. The `github/awesome-copilot` project now documents an **external
plugin submission workflow** for public GitHub-hosted plugins. Do not directly
open a PR editing its `plugins/external.json`.

The next step for curated discovery is to open its
[External plugin submission form](https://github.com/github/awesome-copilot/issues/new?template=external-plugin.yml)
after reviewing its policies and checking for duplicate listings. Use:

| Form field | Value |
| --- | --- |
| Plugin name | `azure-devops` |
| GitHub repository | `lawynn/azure-devops-mcp` |
| Plugin path | `plugin` |
| Commit SHA to review | Full 40-character reviewed `main` commit (`git fetch origin`, then `git rev-parse origin/main`) |
| Ref to review | Optional immutable release tag; not required when a SHA is supplied. Do not submit a moving branch as an immutable ref. |
| Version | `0.1.0`, matching `plugin/plugin.json` |
| License / author | `MIT` / `lawynn` |
| Keywords | `azure-devops`, `mcp`, `multi-account` |

Use the manifest's description and explain the multi-account routing benefit.
An immutable SHA is sufficient; creating a release tag, npm publisher or VS Code
publisher is not a prerequisite for this review route.

The documented gates include metadata validation, Agent Plugins compliance,
`vally lint`/Agent Skills validation and a Copilot CLI install smoke test.
After those pass, human maintainers review the submission; `/approve` leads to
an automated catalog PR. Approval and merging are not guaranteed. Source
updates can request a new intake pass with `/rerun-intake` while the issue is
open. No issue, tag or third-party catalog PR has been submitted by this work.

`github/copilot-plugins` is currently an ordinary non-default marketplace,
not automatic built-in placement. Registering our own public repository does
not add it to either collection. The direct GitHub URL and our catalog remain
usable independently of any curated acceptance.

Sources:

- [Awesome Copilot external plugin contribution/review policy](https://github.com/github/awesome-copilot/blob/main/CONTRIBUTING.md#adding-external-plugins)
- [Exact submission form and required fields](https://github.com/github/awesome-copilot/blob/main/.github/ISSUE_TEMPLATE/external-plugin.yml)
- [CLI built-in marketplace behavior](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-plugin-reference)

## 2. npm and the official MCP Registry: prepared, not published

The official registry stores **metadata, not your executable artifact**. For
this route, publish the actual npm package first, then register its metadata.
The planned package name is `@lawynn/azure-devops-mcp` (ownership/availability
must be confirmed with the operator's npm account). `package.json` includes
`mcpName: io.github.lawynn/azure-devops-mcp`; `server.json` uses the matching
namespace/version and npm identifier with stdio transport. Its registry schema
is the documented `2025-12-11` version.

Release checklist:

- Review source, dependency licenses and `npm pack --dry-run` contents.
- Run `npm ci --ignore-scripts`, `npm run check:bundle`, `npm run check` and
  `npm run validate:metadata`. CI checks Windows/Linux, Node 22/24.
- Confirm actual authenticated read-only access in intended tenants with
  explicit user approval; do not make test writes against production.
- Update versions together: package, lockfile, server implementation version,
  plugin manifest, marketplace entry and registry metadata. Rebuild and commit
  the bundle, digest and notices.
- Confirm npm scope ownership, package name, licensing, account security and
  access policy. With release approval, authenticate to npm and run
  `npm publish --access public`; no release command is executed by CI.
- Only after npm availability, obtain the official `mcp-publisher`, run
  `mcp-publisher login github`, then `mcp-publisher publish`. GitHub namespace
  verification must correspond to `lawynn`.
- Verify package/registry availability, then document the exact published
  version before recommending `npx @lawynn/azure-devops-mcp`.

GitHub Actions OIDC is documented for future registry automation. Add it only
after configuring the relevant trusted publisher/account settings and
protected release approvals. The current workflow intentionally has read-only
repository permissions and **does not** publish.

Sources:

- [MCP Registry quickstart](https://modelcontextprotocol.io/registry/quickstart)
- [Registry GitHub Actions / OIDC](https://modelcontextprotocol.io/registry/github-actions)
- [Registry server schema](https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json)

## 3. VS Code Marketplace: separate product wrapper

A Copilot CLI plugin is **not** a VS Code extension. Publishing to the VS Code
Marketplace requires a VS Code extension manifest/wrapper, publisher identity,
VSIX packaging and `@vscode/vsce` publication. That wrapper is not part of this
v1; the standalone MCP configuration can still be supplied to MCP-capable
clients. Likewise, an Azure DevOps Marketplace extension is not automatically
created by an MCP server repository.

Source: [Publishing VS Code extensions](https://code.visualstudio.com/api/working-with-extensions/publishing-extension).

## Dependency audit notes

The package ships a bundle and has no external runtime dependencies; SDKs and
build tools are development dependencies. The committed license inventory
records packages actually included by the bundler. This separation is not a
substitute for auditing the bundled code.

Azure Identity is pinned to 4.13.0 because the newer 4.14.0 resolves an MSAL
version affected by
[GHSA-xcx6-jx8p-x3h5](https://github.com/advisories/GHSA-xcx6-jx8p-x3h5).
Its MSAL 3.x dependency uses only UUID's `v4` API; a scoped override selects
UUID 11.1.1 to avoid
[GHSA-w5hq-g745-h8pq](https://github.com/advisories/GHSA-w5hq-g745-h8pq).
Revisit these pins when the Azure Identity stable line adopts patched MSAL.

The full development dependency audit also reports the official MCP SDK's
Express/body-parser HTTP dependency:
[GHSA-27r3-jxmh-p828](https://github.com/advisories/GHSA-27r3-jxmh-p828).
The patched body-parser 2.4.0 was unavailable from the validation environment's
package registry. This project exposes **stdio only**, does not import the
SDK's HTTP server transport, and neither Express nor body-parser is included
in the bundled runtime/license inventory. Do not infer that the full development
dependency audit is clean or reuse these dependency versions for an HTTP server.
Recheck upstream availability before a registry release.

## Authentication references

The implementation uses the documented ADO Entra resource ID, but deliberately
uses per-command tenant/subscription selectors rather than the documentation's
global `az account set` setup pattern. Organization access and permissions are
still required for service principals and managed identities.

- [Issue Entra tokens with Azure CLI](https://learn.microsoft.com/en-us/azure/devops/cli/entra-tokens?view=azure-devops)
- [Service principals and managed identities in Azure DevOps](https://learn.microsoft.com/en-us/azure/devops/integrate/get-started/authentication/service-principal-managed-identity?view=azure-devops)
- [Pipeline runs list API and its fixed result limit](https://learn.microsoft.com/en-us/rest/api/azure/devops/pipelines/runs/list?view=azure-devops-rest-7.1)
