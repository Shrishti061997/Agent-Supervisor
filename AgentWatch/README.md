# AgentWatch

A live supervisor for an agent's proposed tool actions. The user can pause, stop, redirect, or approve a single held lookup. Actions are checked before execution, and PDF figures are checked against their source before release.

## Run the demo

1. Start **Confidential access + unnecessary lookup** in scripted mode.
2. Watch the approved CSV read and blocked confidential-file proposal.
3. At the external lookup hold, choose **Use only my spreadsheet**.
4. Download the checked PDF and audit JSON.
5. Run **Confident mistake in report totals**, observe the $47,000 proposal held, and choose **Use verified figures**.
6. Pause/stop any active run. For a model-driven worker, select TokenRouter and enter your key and exact model ID.

## What is real

The backend policy gate, human controls, persistent run records, public lookup after exact approval, source checks, PDF bytes, and SHA-256 artifact digest are implemented. Scripted mode uses predefined worker proposals for a repeatable demo. TokenRouter mode uses a model to propose one action at a time and a separate model call to review the purpose of actions that pass the hard policy. The identical backend gate enforces both modes. The model reviewer can narrow permission; it cannot overrule a hard denial. Every approved proposal is displayed at a checkpoint before a separate request executes it. Disable auto advance for an unlimited review period.

Inputs are fictional fixtures exposed through a restricted tool gateway. There is no arbitrary shell, host filesystem, uploaded-file ingestion, or connection into an existing Codex/ChatGPT session. Confidential file contents are never loaded or passed to the reviewer. Output checks cover exact source totals, a supported fixed narrative, output location, and a limited sensitive-marker scan. They do not certify general factual accuracy or exhaustive security.

## Trust tests

| Test | Mechanism |
|---|---|
| Verified | Backend allowlist before access; PDF figures independently recomputed from fixture source |
| Calibrated | HOLD for unnecessary lookup, unsupported totals, or unsupported narrative; errors pause the worker |
| Overseeable | Source inspection; pause, stop, redirect, approve exact lookup, or repair figures |
| Auditable | R2 run record with proposals, rule decisions, human steering, checks, timestamps, and artifact digest |

## Architecture

`Worker proposal -> backend evaluate() -> ALLOW / HOLD / BLOCK -> controlled tool -> source checks -> artifact release`

The model proposes actions; only application code executes them. R2 conditional writes prevent a stop or redirection from being overwritten by an in-flight model response. Stop prevents further scheduling and output release, but cannot undo an already executed action or terminate an already dispatched provider call.

## Integrations

- TokenRouter: implemented Chat Completions adapter at `https://api.tokenrouter.com/v1/chat/completions`. Credentials are held in browser memory for the current session or configured as server runtime secrets. They are not persisted in run records. Model IDs must come from the user's console.
- HarnessRouter: not connected. To integrate, forward pre-execution proposals through `evaluate()` using an actual blocking runtime hook; a trace stream alone cannot enforce access.
- Ezio: not connected; no live evaluation API is assumed. A future evidence adapter can contribute findings, but must not override the enforced access policy.

## Development

No package install is required. Node 20+.

```sh
npm test
npm run build
node scripts/dev-server.mjs
```

Open `http://localhost:8080`. The local adapter emulates R2 in memory and loses runs at restart; the hosted app uses real R2. It is for a local demonstration and binds only to loopback.

Hosted environment: `BUCKET` R2 binding. Optional runtime secrets: `TOKENROUTER_API_KEY` and `TOKENROUTER_MODEL`. Never commit keys.

