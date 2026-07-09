# Enrichment + Summary Prompt (master copy)

**Node:** `Enrich (LLM)` — `@n8n/n8n-nodes-langchain.chainLlm` + Anthropic `claude-sonnet-5` (`maxTokensToSample: 2048`, no sampling params) + Structured Output Parser. Runs AFTER `Classify (LLM)`.
**Edit here first, then paste into the node's `text` field.** Keep this file and the node in sync.
> Note: in the workflow JSON the `text` value is stored with a leading `=` (n8n expression mode) so `{{ }}` interpolates — that `=` is n8n plumbing, not part of the prompt below.

Design notes:
- **Extraction only, no arithmetic** — the model extracts `billingAmounts.charged` / `.contract`; the deterministic Code node (task 2.4) computes the delta and the >$500 test. Keeping math out of the LLM makes the escalation auditable.
- **No hallucination** — identifiers must be literally present in the message.
- Enrich's input item is the Classify output (`$json.output`), so the raw text is pulled from the earlier node by name: `$('Normalize Input').item.json.rawMessage`.
- **No `temperature`** — Claude Sonnet 5 rejects non-default sampling parameters (400). Reproducibility of the identifier set rests on the closed `type` enum and the "exactly as written" instruction, not on greedy decoding.
- **`onError: continueRegularOutput`** — same failure contract as Classify. A missing `summary` is what `Route & Escalate` treats as "enrichment failed" (Rule 0), which escalates the record to human review rather than writing a half-empty row to the Sheet.
- **Category read defensively** — `{{ $json.output?.category || "Unknown (classification step failed)" }}`. Without the optional chain, a failed Classify makes this expression throw and takes the item down with it.

## Prompt text (pasted verbatim into the chain `text` param)

```
You are a support-triage analyst at ArcVault, a B2B SaaS company. A prior step has already classified this message. Now extract structured details and write a short team-facing summary. Use ONLY facts stated in the message — never invent identifiers, numbers, or details that are not literally present.

Extract:
- coreIssue: the central problem or request, in ONE sentence.
- identifiers: every concrete identifier literally present in the message. For each, give a type (one of: account_id, invoice_number, error_code, url, timestamp, amount, product_area) and its value exactly as written. If there are none, return an empty array.
- urgencySignal: low, medium, or high — how time-sensitive the message sounds, based on its wording and impact (service down or many users affected or a hard deadline = high; a routine question = low).
- billingAmounts: EXTRACTION ONLY. charged = the amount the customer says they were charged (a number, no currency symbol), or null if not stated. contract = the amount they say their contract or agreed rate is (a number), or null if not stated. Do NOT compute any difference — extraction only; a later deterministic step does the arithmetic.
- summary: 2 to 3 sentences for the receiving team — the issue, the key facts, and a suggested first action — written so a queue owner can act without re-reading the original message.

Classified category: {{ $json.output?.category || "Unknown (classification step failed)" }}
Message source: {{ $('Normalize Input').item.json.source }}
Message: {{ $('Normalize Input').item.json.rawMessage }}
```

## Output schema (Structured Output Parser, manual JSON Schema)

```json
{
  "type": "object",
  "properties": {
    "coreIssue": { "type": "string" },
    "identifiers": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "type": { "type": "string", "enum": ["account_id", "invoice_number", "error_code", "url", "timestamp", "amount", "product_area"] },
          "value": { "type": "string" }
        },
        "required": ["type", "value"]
      }
    },
    "urgencySignal": { "type": "string", "enum": ["low", "medium", "high"] },
    "billingAmounts": {
      "type": "object",
      "properties": {
        "charged": { "type": ["number", "null"] },
        "contract": { "type": ["number", "null"] }
      },
      "required": ["charged", "contract"]
    },
    "summary": { "type": "string" }
  },
  "required": ["coreIssue", "identifiers", "urgencySignal", "billingAmounts", "summary"]
}
```

## Expected extraction on the 5 official samples (spot checks)

| id | key identifiers | billingAmounts | urgency |
|----|-----------------|----------------|---------|
| msg-001 | error_code 403, url arcvault.io/user/jsmith | {null, null} | high |
| msg-002 | (product_area: audit logs / export) | {null, null} | low |
| msg-003 | invoice_number 8821, amount $1,240, amount $980 | {charged: 1240, contract: 980} | medium |
| msg-004 | product_area SSO/Okta | {null, null} | low |
| msg-005 | timestamp ~2pm EST | {null, null} | high |
