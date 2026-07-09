# ArcVault Intake & Triage Pipeline

An agentic **intake & triage pipeline** that turns unstructured customer messages (email / web form / support portal) into structured, classified, routed, and escalation-aware records. Built for the Valsoft AI Engineer take-home using free/open-source tools.

**Stack:** [n8n](https://n8n.io) (orchestration) · **Anthropic `claude-sonnet-5`** (classification + enrichment) · Google Sheets (structured output + escalation queue) · [webhook.cool](http://webhook.cool/) (downstream system simulation).

## What it does

For each inbound message the workflow:
1. **Ingests** it via a webhook trigger.
2. **Classifies** it (LLM) — Category ∈ {Bug Report, Feature Request, Billing Issue, Technical Question, Incident/Outage}, Priority ∈ {Low, Medium, High}, and a confidence score.
3. **Enriches** it (LLM) — one-sentence core issue, extracted identifiers (invoice #, error code, URL, amounts…), an urgency signal, and a 2–3 sentence team-facing summary.
4. **Routes** it — deterministic category → queue map (Engineering / Product / Billing / IT/Security), with a human-review fallback for low confidence.
5. **Persists** a full JSON record to Google Sheets + POSTs it to a downstream endpoint + returns it to the caller.
6. **Escalates** — confidence < 0.70, literal outage keywords, a billing discrepancy > $500, or an Incident/Outage category flags the record and routes it to a separate escalation queue.

Routing and escalation are **deterministic code** (a single n8n Code node, unit-tested 23/23), not the LLM — so the business rules are auditable and cheap. The two LLM steps are kept separate for single-purpose prompts and isolated failure.

## Quickstart

```bash
# 1. Run n8n
docker run -d --name n8n -p 5678:5678 -v n8n_data:/home/node/.n8n docker.n8n.io/n8nio/n8n
# open http://localhost:5678, create the owner account

# 2. Import the workflow
#    n8n → Workflows → Import from File → workflow/arcvault-intake-triage.json

# 3. Add credentials in the n8n UI (you supply the keys — see docs/RUNBOOK.md):
#    - Anthropic API → select it on both "Anthropic Model - *" nodes
#    - Google Sheets OAuth2 → select it on both "Append to *" nodes; pick the Records / Escalation Queue tabs
#    The Sheet ID + webhook.cool URL are pre-filled with the demo values; to use your own,
#    edit the two "Append to *" (Google Sheets) nodes + the "POST to webhook.cool" node.

# 4. Publish (activate) the workflow, then feed the samples
bash scripts/send-samples.sh
```

Full manual setup (owner account, Anthropic key, Google Sheet with the 17-column header, webhook.cool) is in **[docs/RUNBOOK.md](docs/RUNBOOK.md)**.

## Repo map

| Path | What |
|------|------|
| `workflow/arcvault-intake-triage.json` | The n8n workflow (import this) — 16 nodes |
| `prompts/classify.md`, `prompts/enrich.md` | Master copies of the two LLM prompts |
| `data/samples.json` | 6 inputs (5 official + 1 synthetic ambiguous demo) |
| `scripts/send-samples.sh` | Feeder — POSTs each sample to the webhook |
| `scripts/test-route-node.mjs` | Dev-time unit test (23 assertions) for the routing/escalation Code node — extracts its real code from the workflow JSON. Run: `node scripts/test-route-node.mjs` |
| `output/records.json` | **The 5 official output records** (deliverable 4.2) |
| `output/records-demo-msg-006.json` | The low-confidence fallback demo record |
| `docs/ARCHITECTURE.md` | System design write-up (deliverable 4.4) |
| `docs/PROMPTS.md` | Prompt documentation + rationale (deliverable 4.3) |
| `docs/DEMO_SCRIPT.md` | Recording walkthrough script |
| `docs/run-log.md`, `docs/consistency.md` | Live-run results + 3-run consistency evidence |
| `docs/screenshots/` | Per-step screenshots (deliverable 4.1) |

## Model choice

**Anthropic `claude-sonnet-5`** — strong instruction-following and reliable strict JSON via n8n's structured-output parser, which both LLM chains depend on. The pipeline originally ran on Groq's free-tier `llama-3.3-70b-versatile`, but the free tier's token-per-minute/day limits couldn't sustain two LLM calls per message across repeated test runs, so the chat-model node was swapped to Sonnet 5 — same prompts, same parsers, only the model node changed. Sonnet 5 rejects non-default sampling parameters (`temperature`, `top_p`, `top_k` each return a 400), so temperature can't be pinned to 0; determinism comes from the prompt and the output schema instead. A local Ollama model remains the documented fallback if API access is unavailable. Full reasoning in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
