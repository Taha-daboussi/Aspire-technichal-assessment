# Classification Prompt (master copy)

**Node:** `Classify (LLM)` — `@n8n/n8n-nodes-langchain.chainLlm` + Anthropic `claude-sonnet-5` (`maxTokensToSample: 2048`, no sampling params) + Structured Output Parser.
**Edit here first, then paste into the node's `text` field.** Keep this file and the node in sync.
> Note: in the workflow JSON the `text` value is stored with a leading `=` (n8n expression mode) so `{{ }}` interpolates — that `=` is n8n plumbing, not part of the prompt below.

Design notes:
- **No `temperature`** — Claude Sonnet 5 removed the sampling parameters; a non-default `temperature`, `top_p`, or `top_k` returns a 400. Determinism cannot be pinned at the API level, so the enum-constrained output schema and the confidence banding rule carry that load instead. Label stability was checked by re-running the 5 samples across 3 runs.
- **Token budget 2048** — `reasoning` is free text emitted before the labels and shares the completion budget; a truncated completion fails the Structured Output Parser. The prompt caps reasoning at 3 sentences and the budget leaves headroom.
- **`onError: continueRegularOutput`** — a chain or parser failure passes the item through with no `output` key instead of killing it. `Route & Escalate` detects the missing output and escalates to human review (Rule 0). An unclassifiable message is exactly the kind a human should read.

## Prompt text (pasted verbatim into the chain `text` param)

```
You are a senior customer-support triage analyst at ArcVault, a B2B SaaS company. Classify ONE inbound customer message into exactly one category, assign a priority, and report your genuine confidence.

CATEGORIES (choose exactly one):
- Bug Report — a specific feature or function is malfunctioning for the user (error message, wrong or unexpected behavior) while the service as a whole is up.
- Feature Request — the user asks for a new capability or enhancement that does not exist yet.
- Billing Issue — anything about invoices, charges, payments, pricing, or contract amounts, including both discrepancies and questions.
- Technical Question — a how-to, configuration, integration, or evaluation question about existing functionality; nothing is broken.
- Incident/Outage — a service is currently unavailable, unreachable, or broadly degraded, especially when multiple users are affected.

DISAMBIGUATION RULES:
- Incident/Outage vs Bug Report: Outage = the service itself is down or unreachable, or multiple users are affected (e.g. the app is unreachable or broadly failing). Bug Report = one specific function misbehaves while the service as a whole is up. A single user who cannot log in is a Bug Report (priority High per the rubric), not an outage.
- Technical Question vs Feature Request: A Technical Question asks HOW to use, configure, or integrate something that already exists (e.g. asking how to configure SSO with an identity provider while evaluating options → Technical Question). A Feature Request asks us to BUILD something new that is not available yet (e.g. requesting a new scheduled bulk-export capability).
- Billing Issue: any money, invoice, charge, or pricing topic — a charge that disagrees with the contract rate is a Billing Issue, not a Bug Report.

PRIORITY RUBRIC (apply strictly):
- High — service is down, multiple users are blocked, a security concern, or the user is locked out of access (cannot log in / authentication failure).
- Medium — a single user is degraded on a core function, OR a money/billing discrepancy.
- Low — a general question, a feature request, or nothing is currently blocked.

CONFIDENCE (0.0 to 1.0): your genuine certainty in the category. Reserve confidence above 0.85 for a message with a single clear category backed by explicit detail. If two or more categories each plausibly apply AND the message lacks the detail to decide between them, you MUST set confidence to 0.6 or lower. Do NOT inflate — a vague, hedging, or mixed-signal message should score below 0.70.

Reason first, then commit to the fields. Keep `reasoning` to at most 3 sentences. Base every field ONLY on the message content below.

Message source: {{ $json.source }}
Message: {{ $json.rawMessage }}
```

## Output schema (Structured Output Parser, manual JSON Schema)

`reasoning` is listed first so the model produces its justification before committing to the label (chain-of-thought elicitation under a structured parser).

```json
{
  "type": "object",
  "properties": {
    "reasoning": { "type": "string", "description": "Step-by-step justification for the chosen category and priority, written before deciding. At most 3 sentences." },
    "category": { "type": "string", "enum": ["Bug Report", "Feature Request", "Billing Issue", "Technical Question", "Incident/Outage"] },
    "priority": { "type": "string", "enum": ["Low", "Medium", "High"] },
    "confidence": { "type": "number", "minimum": 0, "maximum": 1 }
  },
  "required": ["reasoning", "category", "priority", "confidence"]
}
```

## Expected results on the 5 official samples

| id | category | priority | note |
|----|----------|----------|------|
| msg-001 | Bug Report | High | login fails → user locked out of access (High derivable from rubric) |
| msg-002 | Feature Request | Low | bulk export = new capability |
| msg-003 | Billing Issue | Medium | invoice vs contract discrepancy |
| msg-004 | Technical Question | Low | asking HOW to set up SSO, evaluating |
| msg-005 | Incident/Outage | High | dashboard down, multiple users |
