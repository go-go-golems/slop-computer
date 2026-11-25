---
Title: "The Pi model backend: models, tiers and credentials"
Slug: "llm-backend-pi"
Short: "llm: pi and --llm pi|fake, the Pi agent directory slop reads (settings, models-store, models, auth), tiers and thinking levels, credential handling, a Kubernetes setup, and how to verify it."
Topics:
- llm
- server
- configuration
- deployment
Commands:
- serve
- sample
- llm
- policy
Flags:
- llm
- config
IsTopLevel: false
IsTemplate: false
ShowPerDefault: true
SectionType: GeneralTopic
---
slop does not hold API keys or model lists of its own. With `llm: pi` it
reads a **Pi agent directory**, the folder the Pi coding agent keeps its
providers, models and logins in, and calls those models through Geppetto.
Models and credentials are managed with Pi (or by hand, as JSON files) on the
server; they never reach a database, a page or a browser.

This page covers choosing the backend, the files slop reads, how tiers map to
models, credentials, a Kubernetes setup, and how to check it works. Who may
spend is a separate question: `slop help llm-access`.

## Choosing a backend

| Setting | Effect |
| --- | --- |
| `llm: pi` in `slop.yaml`, or `slop serve --llm pi` | Pi's models through Geppetto |
| `llm: fake`, or `--llm fake` | A deterministic test model: `sample` answers `slop is connected.`, agent sessions run a script (`slop help capability-sample`, `slop help capability-agent`) |
| `--test` (or `test: true`) | `fake`, unless `llm` says otherwise |
| nothing | No backend: every model call fails "this server has no model backend" |

```yaml
llm: pi
pi:
  agent_dir: /var/lib/slop/pi        # default: ~/.pi/agent of the user running slop
  models:                            # optional: pin the tiers
    quick: lunaroute/small
    default: lunaroute/medium
    complex: lunaroute/large:high
```

slop reads `pi.agent_dir` only; it does not look at `PI_CODING_AGENT_DIR`.
The directory is read **once, at start**: restart slop after changing it.

## The files in the agent directory

slop reads four files, in the format Pi writes them. A missing file counts as
empty; a malformed one stops the server at start.

| File | What slop reads |
| --- | --- |
| `settings.json` | `defaultProvider`, `defaultModel`, `defaultThinkingLevel`, `enabledModels` (a list of `provider/model`) |
| `models-store.json` | The model catalog Pi refreshed from its providers: `{"<provider>": {"models": [{id, name, api, baseUrl, reasoning, input, contextWindow, maxTokens, …}]}}` |
| `models.json` | Your own providers and models, merged over the catalog: `{"providers": {"<id>": {baseUrl, api, apiKey, headers, compat, models: [...]}}}` |
| `auth.json` | One credential per provider: `{"<provider>": {"type": "api_key", "key": "…"}}` or `{"type": "oauth", "access": "…", "refresh": "…", "expires": …}` |

A model is **available** when its `api` is one Geppetto speaks
(`openai-completions`, `openai-responses`, `openai-codex-responses`,
`anthropic-messages`, `google-generative-ai`) and its provider has a
credential: an `auth.json` entry, else an `apiKey` in `models.json`.

Values in `models.json` (`apiKey`, header values) and `auth.json` keys may be
`$NAME` or `${NAME}`, read from slop's environment; `$$` is a literal `$`.
Pi's `!command` values are **not** run by slop. Provider URLs must be public
HTTPS: slop refuses plain-HTTP and loopback or private-network endpoints, so
a gateway on `localhost` does not work.

A minimal hand-written directory, with one provider and its key in the
environment. `models.json`:

```json
{ "providers": { "demo": {
    "baseUrl": "https://api.example.com/v1", "api": "openai-completions", "apiKey": "$DEMO_KEY",
    "models": [
      { "id": "small", "name": "Demo small" },
      { "id": "big", "name": "Demo big", "reasoning": true, "input": ["text", "image"], "maxTokens": 8192 } ] } } }
```

`settings.json`:

```json
{ "defaultProvider": "demo", "defaultModel": "big", "defaultThinkingLevel": "medium" }
```

```text
$ DEMO_KEY=… slop serve --config slop.yaml
2026/11/24 18:54:01 Pi models ready (Geppetto): 2
```

## Tiers and the model a call gets

Pages and actors ask for a **tier** (`quick`, `default`, `complex`) and
optionally a **model**. slop maps each tier at start:

1. `pi.models.<tier>`, a reference `provider/model` or `provider/model:level`,
   or a bare model id that names exactly one available model. One that is not
   available stops the server: `no authenticated model "demo/missing" for quick`.
2. A tier not listed gets Pi's **preferred model**: `settings.json`'s
   `defaultProvider/defaultModel` when it is available (and in
   `enabledModels`, if that is set); else the first available entry of
   `enabledModels`; else the first available model.
3. No available model at all stops the server: `no authenticated model for
   quick: configure Pi or pass --model-quick` (there is no such flag: set
   `pi.models` or add a credential).

A call's explicit `model` (`provider/model`, or a unique bare id) runs on that
model when it is available; otherwise the call runs on its tier, without an
error (`modelApplied` is then absent in a page's result).
`sample.limits().models` lists the tier models first (each with its `tier`),
then every other available model, with `reasoning`, `thinkingLevels` and
`images`.

A model without image input answers `images_unavailable` to a call with
images: pick an image model for the tier pages send images on.

## Thinking levels

Pi's levels are `off`, `minimal`, `low`, `medium`, `high`, `xhigh`. One call's
level is the first of:

1. the call's `effort` (`low`, `medium` or `high`);
2. the level in the tier's reference (`complex: lunaroute/large:high`);
3. for `default` and `complex`: `settings.json`'s `defaultThinkingLevel`;
   for `quick`: `off`.

A level only matters for a reasoning model; models without reasoning ignore
it.

## A read-only agent directory is fine

slop never writes `models-store.json`, `models.json` or `settings.json`. It
writes `auth.json` only to save a refreshed **Codex** login (`openai-codex`):
its refresh tokens rotate, so the new credential must be stored, under Pi's
lock (an `auth.json.lock` directory next to it). Every other provider works
from a read-only mount. If you use `openai-codex`, the directory must be
writable by slop.

## Credentials

- **Copy only the providers you need.** Build an `auth.json` (and
  `models.json`) for the server with just the providers its tiers use; do not
  copy a laptop's whole Pi directory.
- **Never share a rotating credential between two machines.** An
  `openai-codex` login's refresh token is replaced on every refresh: the
  first machine to refresh invalidates the other's copy, and one of them stops
  working. Log in to Pi on the server itself, or give each machine its own
  login.
- **Static keys are safe to copy.** An `api_key` entry, or a gateway key such
  as LunaRoute's (stored as an `oauth` entry whose `access` is the key; its
  refresh returns the same key), does not change.
- Prefer `$NAME` in `models.json` with the key in the environment, or an
  `auth.json` mounted from a secret, over keys in a ConfigMap.
- Provider error details never reach pages. A bad or expired credential shows
  as `authentication_error` "Pi authentication for this provider failed. Log
  in through Pi, then restart slop." in `slop sample run`, and as
  `upstream_error` in a page.

slop sends LunaRoute requests with the headers `lunaroute-agent: slop` and a
per-process session id.

## Kubernetes

Keep the non-secret files in a ConfigMap and `auth.json` in a Secret,
projected into one read-only directory:

```yaml
apiVersion: v1
kind: ConfigMap
metadata: {name: slop-pi}
data:
  settings.json: |
    {"defaultProvider": "lunaroute", "defaultModel": "medium", "defaultThinkingLevel": "medium"}
  models-store.json: |
    {"lunaroute": {"models": [{"id": "small", "api": "openai-completions", "baseUrl": "https://lunaroute.example.com/v1"},
                              {"id": "medium", "api": "openai-completions", "baseUrl": "https://lunaroute.example.com/v1", "reasoning": true}]}}
---
apiVersion: v1
kind: Secret
metadata: {name: slop-pi-auth}
stringData:
  auth.json: |
    {"lunaroute": {"type": "api_key", "key": "…"}}
```

```yaml
# in the Deployment's pod spec
volumes:
- name: pi
  projected:
    sources:
    - configMap: {name: slop-pi}
    - secret: {name: slop-pi-auth}
containers:
- name: slop
  volumeMounts:
  - {name: pi, mountPath: /var/lib/slop/pi, readOnly: true}
```

```yaml
# slop.yaml (from the configuration ConfigMap)
llm: pi
pi:
  agent_dir: /var/lib/slop/pi
  models: {quick: lunaroute/small, default: lunaroute/medium, complex: lunaroute/medium:high}
```

A Codex login cannot live in a read-only projection: put that directory on
the data volume instead. The pod's network policy must allow the providers'
hosts. Restart the pod after changing either object.

## Verifying it

1. The server log at start: `Pi models ready (Geppetto): N`, with N the
   number of available models. A start that fails names the agent directory
   and the tier that has no model.
2. As an admin (`@admin` has LLM access on a new server), ask through each
   tier:

   ```bash
   slop sample run --input "Say hi in three words" --modelTier quick
   slop sample run "Say hi" --modelTier complex --effort high
   slop sample run "Say hi" --model lunaroute/small -o json
   ```

   The answer streams on stderr; the result shows `model` (the provider and
   model that answered) and `usage`.
3. Give the apps access: `slop policy set <app> sample @member on`,
   `slop llm set @member on --budget …` (`slop help llm-access`).

## Troubleshooting

| Problem | Cause | Solution |
| --- | --- | --- |
| `load Pi's models from <dir>: no authenticated model "x/y" for quick` | The tier names a model that is not in the catalog, or its provider has no credential | Check the id against `models-store.json` / `models.json`; add the credential |
| `no authenticated model for quick: configure Pi or pass --model-quick` | No model has a credential | Add an `auth.json` entry or an `apiKey`; there is no `--model-quick` flag |
| `unknown llm "…" (pi or fake)` | Bad `llm` value | `pi`, `fake`, or empty |
| Every call: "this server has no model backend" | No `llm` set | `llm: pi` or `--llm pi` |
| `authentication_error` in `slop sample run` | The provider refused the credential (expired, revoked, or a Codex token another machine rotated) | Log in through Pi on the server; restart slop |
| `upstream_error` "The model provider request failed…" | Network, a wrong `baseUrl`, an unset `$NAME`, or a local/HTTP endpoint | Check the URL is public HTTPS and the environment variable is set |
| `rate_limited` | The provider's rate limit | Wait; spread load over tiers |
| Codex stops working after a while | `auth.json` is read-only, or the same login is used elsewhere | A writable directory and a login of its own |
| `images_unavailable` | The tier's model has no image input | Map that tier to an image model (`"input": ["text", "image"]`) |
| A change to the agent directory has no effect | It is read at start | Restart slop |

## See Also

- `slop help server-configuration` — `slop serve`, `slop.yaml`, Kubernetes
- `slop help llm-access` — LLM access, budgets, policy
- `slop help capability-sample` — model calls from pages and actors
- `slop help capability-agent` — server-held sessions
