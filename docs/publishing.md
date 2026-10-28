# Distribution and publication research

Reviewed against first-party documentation on **2026-10-28**. Publishing is an
operator action: this repository does not automatically publish on push/tag.
No registry credentials, publisher accounts, marketplace submissions or plugin
installations are created by the implementation.

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
Once these files are on the default branch:

```text
copilot plugin marketplace add lawynn/azure-devops-mcp
copilot plugin install azure-devops@lawynn-azure-devops
```

Before merge, clone/check out `lawynn-azure-devops-mcp` and install the local
`plugin` directory instead. Do not advertise default-branch marketplace
installation while the implementation exists only on the feature branch.
Copilot caches plugins; reinstall a changed local plugin to refresh it.

**This is a self-hosted Git repository marketplace**, not acceptance into a
built-in/curated marketplace. Being public is sufficient to host the manifest,
not evidence of endorsement, discoverability or compatibility in every client.
No client plugin installation has been performed here. Copilot desktop
support is unverified; CLI documentation must not be presented as a guarantee
for the desktop app. The generic stdio MCP configuration is a separate route.

Sources:

- [Creating a plugin for Copilot CLI](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/plugins-creating)
- [Creating a plugin marketplace](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/plugins-marketplace)
- [CLI plugin command/manifest reference](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-plugin-reference)

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
