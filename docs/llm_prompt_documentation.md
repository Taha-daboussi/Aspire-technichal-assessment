# LLM Prompt Documentation (Deliverable 4.3)

Two LLM steps run per message: **Classify** and **Enrich**. Routing, escalation, and all arithmetic are deterministic JavaScript in a Code node, so these two prompts are the entire surface where a model influences the output.

**Model:** `claude-sonnet-5` via the n8n Anthropic Chat Model node, `maxTokensToSample: 2048`, no sampling parameters (Sonnet 5 returns a 400 on a non-default `temperature`). Each chain uses a `Structured Output Parser` with a hand-written JSON Schema.

**Why two calls instead of one:** classification and extraction fail differently. A malformed identifier array shouldn't take the category down with it, and each prompt keeps a single job, which is what makes the priority rubric and the no-arithmetic rule enforceable.

---

## Prompt 1: Classification

**Node:** `Classify (LLM)`. Input is the normalized webhook item.

```
You are a senior customer-support triage analyst at ArcVault, a B2B SaaS company. Classify ONE inbound customer message into exactly one category, assign a priority, and report your genuine confidence.

CATEGORIES (choose exactly one):
- Bug Report - a specific feature or function is malfunctioning for the user (error message, wrong or unexpected behavior) while the service as a whole is up.
- Feature Request - the user asks for a new capability or enhancement that does not exist yet.
- Billing Issue - anything about invoices, charges, payments, pricing, or contract amounts, including both discrepancies and questions.
- Technical Question - a how-to, configuration, integration, or evaluation question about existing functionality; nothing is broken.
- Incident/Outage - a service is currently unavailable, unreachable, or broadly degraded, especially when multiple users are affected.

DISAMBIGUATION RULES:
- Incident/Outage vs Bug Report: Outage = the service itself is down or unreachable, or multiple users are affected (e.g. the app is unreachable or broadly failing). Bug Report = one specific function misbehaves while the service as a whole is up. A single user who cannot log in is a Bug Report (priority High per the rubric), not an outage.
- Technical Question vs Feature Request: A Technical Question asks HOW to use, configure, or integrate something that already exists (e.g. asking how to configure SSO with an identity provider while evaluating options -> Technical Question). A Feature Request asks us to BUILD something new that is not available yet (e.g. requesting a new scheduled bulk-export capability).
- Billing Issue: any money, invoice, charge, or pricing topic - a charge that disagrees with the contract rate is a Billing Issue, not a Bug Report.

PRIORITY RUBRIC (apply strictly):
- High - service is down, multiple users are blocked, a security concern, or the user is locked out of access (cannot log in / authentication failure).
- Medium - a single user is degraded on a core function, OR a money/billing discrepancy.
- Low - a general question, a feature request, or nothing is currently blocked.

CONFIDENCE (0.0 to 1.0): your genuine certainty in the category. Reserve confidence above 0.85 for a message with a single clear category backed by explicit detail. If two or more categories each plausibly apply AND the message lacks the detail to decide between them, you MUST set confidence to 0.6 or lower. Do NOT inflate - a vague, hedging, or mixed-signal message should score below 0.70.

Reason first, then commit to the fields. Keep `reasoning` to at most 3 sentences. Base every field ONLY on the message content below.

Message source: {{ $json.source }}
Message: {{ $json.rawMessage }}
```

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

**Why it's built this way.** Each category names its discriminating condition rather than restating its label, because the failure mode isn't ignorance of what a bug report is - it's that two labels both look defensible, so the disambiguation rules resolve the exact collisions this dataset contains (a 403 on login is a Bug Report, not an outage). Priority is a separate rubric because it cuts across categories, and stating it as three hard conditions is what lifts msg-001 to High. `reasoning` is the first schema key so the justification tokens are emitted before the label, not after it. The tradeoff is the confidence banding: it stops the model reporting 0.9 on everything (which would make the `< 0.70` fallback dead code) but it also drags clear cases down - msg-001 lands at 0.83. With more time I would replace self-reported confidence with agreement across N samples, and gate every prompt edit on a 30-50 message golden set, since the prompts currently have no regression tests while the routing code has 38.

---

## Prompt 2: Enrichment and Summary

**Node:** `Enrich (LLM)`. Runs after Classify; pulls the raw text back by node reference.

```
You are a support-triage analyst at ArcVault, a B2B SaaS company. A prior step has already classified this message. Now extract structured details and write a short team-facing summary. Use ONLY facts stated in the message - never invent identifiers, numbers, or details that are not literally present.

Extract:
- coreIssue: the central problem or request, in ONE sentence.
- identifiers: every concrete identifier literally present in the message. For each, give a type (one of: account_id, invoice_number, error_code, url, timestamp, amount, product_area) and its value exactly as written. If there are none, return an empty array.
- urgencySignal: low, medium, or high - how time-sensitive the message sounds, based on its wording and impact (service down or many users affected or a hard deadline = high; a routine question = low).
- billingAmounts: EXTRACTION ONLY. charged = the amount the customer says they were charged (a number, no currency symbol), or null if not stated. contract = the amount they say their contract or agreed rate is (a number), or null if not stated. Do NOT compute any difference - extraction only; a later deterministic step does the arithmetic.
- summary: 2 to 3 sentences for the receiving team - the issue, the key facts, and a suggested first action - written so a queue owner can act without re-reading the original message.

Classified category: {{ $json.output?.category || "Unknown (classification step failed)" }}
Message source: {{ $('Normalize Input').item.json.source }}
Message: {{ $('Normalize Input').item.json.rawMessage }}
```

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

**Why it's built this way.** This prompt is an extractor, not a reasoner, and almost every line defends that boundary. The anti-hallucination clause is load-bearing: an invented invoice number produces a confident bad record a queue owner will act on. The closed identifier enum keeps the same concept from arriving as three different type strings across three messages. The extraction-only rule on `billingAmounts` is the key design point - the Code node computes `abs(charged - contract)` and applies the `> $500` test, so the escalation is auditable and unit-tested rather than dependent on an LLM doing subtraction (msg-003's delta of $260 provably does not escalate). The summary is specified by audience and action, not by length, because "be concise" only yields a shorter restatement of the message. Tradeoffs: `urgencySignal` is a soft judgment the routing logic never reads, and enrichment runs even on low-confidence messages headed for human review. With more time I would return character offsets with each identifier so "no hallucination" becomes an assertion the pipeline checks rather than an instruction it hopes for.
