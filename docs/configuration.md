# Configuration and credential setup

Configuration is local, operator-controlled JSON. Initialize with
`node .\plugin\server\index.js config init`, or set `ADO_MCP_CONFIG` to an
absolute path. `config validate` checks structure/references, **not live
authentication**. `config show` and MCP `ado_config` return only profile names,
types, organization allowlists and bindings. They do not expose environment
values, certificate paths or Azure CLI cache contents.

See [the example](../examples/config.example.json); every identifier is a fake
placeholder. Replace Windows paths with absolute paths appropriate to your OS.
There is no `~`, `${HOME}` or environment expansion inside JSON values.

## Profiles

Every profile has `type` and a nonempty `organizations` array of public Azure
DevOps organization names. Names are case-normalized. Unknown fields (including
literal `token`, `password` and `secret` values) are rejected. Environment
references must be environment-variable names, not values or `${...}` strings.
All profile keys are case-sensitive and use letters, numbers, `_` or `-`.

| Type | Additional fields | Acquisition and limitations |
| --- | --- | --- |
| `pat` | `tokenEnv` | Reads the exact environment variable and uses HTTP Basic. PAT scopes and expiry are operator-managed. |
| `bearer` | `tokenEnv` | Uses an explicitly supplied ADO audience access token. No refresh flow. |
| `azure-cli` | `configDir`, `tenant`; optional `subscription`, `pythonPath` | Runs `az account get-access-token` with the ADO resource and explicit selectors. Absolute, dedicated config directory required. No login or account set. |
| `client-secret` | `tenantId`, `clientId`, `secretEnv` | Explicit `ClientSecretCredential`; no DefaultAzureCredential chain. |
| `client-certificate` | `tenantId`, `clientId`, `certificatePath` | Explicit `ClientCertificateCredential` using an absolute PEM file path. PEM must contain private key and certificate. PFX/password-protected certificates and subject-name/issuer options are not exposed in v1. |
| `managed-identity` | optional `clientId` | Explicit `ManagedIdentityCredential`; omit clientId for system-assigned identity. Requires a supported Azure managed identity host. Resource-ID/object-ID selectors are not exposed in v1. |
| `workload-identity` | `tenantId`, `clientId`, `tokenFilePath` | Explicit `WorkloadIdentityCredential` with absolute federated token file path. Federation/trust and token rotation must already be configured by the host. |
| `git-helper` | `username` | Requires matching `repoPath` origin on every call; noninteractive HTTPS credential fill with repository path and explicit username. Only username/password-style helper output supported. |

Azure Identity requests exactly
`499b84ac-1321-427f-aa17-267ca6975798/.default`. Azure CLI uses resource
`499b84ac-1321-427f-aa17-267ca6975798`, not Azure Resource Manager. Service
principals and managed identities must be added to the organization and given
appropriate project/repository permissions; Azure RBAC alone does not grant ADO
permissions. Identity instances are per request, without a shared token cache.
SDK token requests are aborted after 30 seconds; provider exceptions are
suppressed, not forwarded to the language model.

## Explicit Azure CLI login, outside MCP

Use a **different configDir per identity**, especially for different users in
the same tenant. A single Azure CLI cache can otherwise select that cache's
currently active user. The server does not mutate `process.env` or global
Azure CLI settings; it passes a copied environment with the profile's directory
only to the token subprocess.

An operator can prepare a work profile in a dedicated PowerShell window:

```powershell
$env:AZURE_CONFIG_DIR = 'C:\Users\EXAMPLE\.azure-work'
az login --tenant 00000000-0000-0000-0000-000000000001
# Or use --allow-no-subscriptions if the account has no subscription.
```

Then configure:

```json
{
  "type": "azure-cli",
  "organizations": ["example-work"],
  "configDir": "C:\\Users\\EXAMPLE\\.azure-work",
  "tenant": "00000000-0000-0000-0000-000000000001"
}
```

An optional subscription is passed with `--subscription`; no `az account set`
is run. Set `AZURE_CONFIG_DIR` and perform `az login` separately for each other
identity, using its own directory. Do not copy tokens into config or chat.
The server never invokes a browser login.

On Windows, the normal Azure CLI MSI provides `az.cmd`, which cannot safely be
spawned without a command shell. The server discovers the adjacent bundled
`python.exe` and runs it with `-I -m azure.cli` and separated argv. For nonstandard
installations, set `pythonPath` to the absolute Azure CLI Python executable.
On other systems `az` must be on PATH. Only trusted executables should be on
PATH; no arbitrary commands are accepted through MCP.

## Git credential helper

This is an opt-in provider, not an automatic fallback. Configure a username
that uniquely identifies the intended account and a repository-specific
binding. Complete authentication in your existing helper **outside MCP**.
The server forces `credential.useHttpPath=true`, disables Git/GCM interaction,
and fills the canonical HTTPS context
`https://dev.azure.com/<org>/<project>/_git/<repo>` with that username.

The local origin is checked again before acquiring a credential. SSH and legacy
remotes can identify context, but their helper lookup is still the canonical
modern HTTPS URL; credentials stored only under a legacy hostname must be set
up for that HTTPS context separately. Pure SSH keys are not REST credentials.
Host-only/default username fallback and returned username mismatches are
rejected. Helpers must honor username/path context; a helper that ignores them
cannot be made safe by the server. Custom Git helpers can execute code and
must be trusted. No credential approve/store/reject calls or global Git
configuration mutations are performed.

## Routing and boundaries

Targets contain an organization name or exact public organization URL, optional
project/repository, optional absolute local `repoPath`, and optional profile.
There is no automatic organization enumeration and no implicit current-repo
selection. `repoPath` requires Git and its `origin`; non-ADO origins fail.
Repository bindings use project/repository names as discovered from the remote.
If calling by repository GUID instead of name, use a corresponding GUID binding
or an explicit profile. There is no network name-to-ID identity guess.

Explicit profile wins, then most-specific repository/project/org binding.
Ties across different profiles, missing bindings, disallowed organizations
and conflicting explicit/inferred contexts fail before credential acquisition.
There is **no identity retry on 401/403**. Paths cannot contain separators,
query fragments, percent escapes, control characters or dot segments.
Human-readable spaces are allowed and escaped once by the server.

Only Azure DevOps Services in the public cloud is supported. Azure DevOps
Server/on-premises collections, NTLM/Kerberos/Windows integrated authentication,
arbitrary OAuth interactive flows, device code login during requests,
sovereign-cloud authority overrides, encrypted certificate options and pure
SSH-key REST authentication are not implemented. A pluggable provider interface
exists in `src/auth.ts`, but loading arbitrary provider code from MCP/config
is deliberately not exposed.

Use least privilege: read-only discovery needs project/repo/work/build read
permissions; PR/work item writes and pipeline queueing need the corresponding
write/execute permissions. There is no server-enforced read-only mode in v1:
disable write tools in the client and use read-only credentials if writes are
not allowed. Never treat MCP annotations as authorization enforcement.
