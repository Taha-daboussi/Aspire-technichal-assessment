// Unit test for the deterministic routing/escalation logic.
//
// It extracts the ACTUAL jsCode from the "Route & Escalate" node in
// workflow/arcvault-intake-triage.json and runs it against mocked n8n
// globals — so the test verifies exactly what runs in production, not a copy.
//
//   node scripts/test-route-node.mjs
//
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const wf = JSON.parse(readFileSync(join(__dirname, '../workflow/arcvault-intake-triage.json'), 'utf8'));
const jsCode = wf.nodes.find((n) => n.name === 'Route & Escalate').parameters.jsCode;

// Wrap the node code so its top-level `return` works, injecting n8n globals.
const run = new Function('$', '$json', jsCode);

function mk(norm, cls, enr) {
  const $ = (name) => {
    if (name === 'Normalize Input') return { item: { json: norm } };
    if (name === 'Classify (LLM)') return { item: { json: { output: cls } } };
    throw new Error('unexpected node ref: ' + name);
  };
  return run($, { output: enr }).json; // $json.output = Enrich result
}

let pass = 0, fail = 0;
const check = (name, cond, detail) =>
  cond ? (pass++, console.log('  ok  ', name))
       : (fail++, console.log('  FAIL', name, '->', JSON.stringify(detail)));

// msg-001 Bug/High, no billing, "403" is not an escalation keyword
let r = mk(
  { id: 'msg-001', source: 'email', rawMessage: 'keep getting a 403 error, cannot log in' },
  { category: 'Bug Report', priority: 'High', confidence: 0.92 },
  { summary: 'ok', billingAmounts: { charged: null, contract: null } });
check('001 queue=Engineering', r.queue === 'Engineering', r.queue);
check('001 suggestedQueue=Engineering', r.suggestedQueue === 'Engineering', r.suggestedQueue);
check('001 not escalated', r.escalated === false, r.escalationReasons);
check('001 delta null', r.billingAmountDelta === null, r.billingAmountDelta);

// msg-002 Feature/Low
r = mk({ source: 'web_form', rawMessage: 'bulk export feature please' },
  { category: 'Feature Request', priority: 'Low', confidence: 0.9 },
  { summary: 'ok', billingAmounts: { charged: null, contract: null } });
check('002 queue=Product', r.queue === 'Product', r.queue);
check('002 not escalated', r.escalated === false, r.escalationReasons);

// msg-003 Billing, delta 260, NOT escalated
r = mk({ source: 'support_portal', rawMessage: 'invoice 8821 charge 1240 vs contract 980' },
  { category: 'Billing Issue', priority: 'Medium', confidence: 0.88 },
  { summary: 'ok', billingAmounts: { charged: 1240, contract: 980 } });
check('003 delta=260', r.billingAmountDelta === 260, r.billingAmountDelta);
check('003 queue=Billing', r.queue === 'Billing', r.queue);
check('003 NOT escalated (260<500)', r.escalated === false, r.escalationReasons);

// msg-005 Incident, no literal keyword -> escalates via category rule
r = mk({ source: 'web_form', rawMessage: 'dashboard stopped loading, multiple users affected' },
  { category: 'Incident/Outage', priority: 'High', confidence: 0.9 },
  { summary: 'ok', billingAmounts: { charged: null, contract: null } });
check('005 escalated via category', r.escalated === true, r.escalationReasons);
check('005 reason=category', r.escalationReasons.some((x) => x.includes('Incident/Outage')), r.escalationReasons);
check('005 no keyword reason', !r.escalationReasons.some((x) => x.includes('keyword')), r.escalationReasons);
check('005 queue=Escalation', r.queue === 'Escalation / Human Review', r.queue);
check('005 suggestedQueue preserved', r.suggestedQueue === 'Engineering', r.suggestedQueue);

// Rule 1: low confidence -> fallback
r = mk({ source: 'email', rawMessage: 'vague' },
  { category: 'Technical Question', priority: 'Low', confidence: 0.65 },
  { summary: 'ok', billingAmounts: { charged: null, contract: null } });
check('lowconf escalated', r.escalated === true, r.escalationReasons);
check('lowconf fallbackUsed', r.fallbackUsed === true, r.fallbackUsed);

// Rule 2: literal 'outage' keyword
r = mk({ source: 'email', rawMessage: 'total OUTAGE right now' },
  { category: 'Bug Report', priority: 'High', confidence: 0.9 },
  { summary: 'ok', billingAmounts: { charged: null, contract: null } });
check('keyword escalated', r.escalated === true, r.escalationReasons);
check('keyword reason present', r.escalationReasons.some((x) => x.includes('keyword')), r.escalationReasons);

// Rule 3: billing > 500
r = mk({ source: 'support_portal', rawMessage: '2000 vs 980' },
  { category: 'Billing Issue', priority: 'Medium', confidence: 0.9 },
  { summary: 'ok', billingAmounts: { charged: 2000, contract: 980 } });
check('billing>500 delta=1020', r.billingAmountDelta === 1020, r.billingAmountDelta);
check('billing>500 escalated', r.escalated === true, r.escalationReasons);

// Boundary: confidence exactly 0.70 -> NOT escalated
r = mk({ source: 'email', rawMessage: 'ok' },
  { category: 'Technical Question', priority: 'Low', confidence: 0.70 },
  { summary: 'ok', billingAmounts: { charged: null, contract: null } });
check('conf==0.70 NOT escalated', r.escalated === false, r.escalationReasons);

// Boundary: delta exactly 500 -> NOT escalated
r = mk({ source: 'support_portal', rawMessage: '1480 vs 980' },
  { category: 'Billing Issue', priority: 'Medium', confidence: 0.9 },
  { summary: 'ok', billingAmounts: { charged: 1480, contract: 980 } });
check('delta==500 value', r.billingAmountDelta === 500, r.billingAmountDelta);
check('delta==500 NOT escalated', r.escalated === false, r.escalationReasons);

// Rule 0: Classify chain failed / parser returned nothing -> human review
r = mk({ id: 'msg-x', source: 'email', rawMessage: 'anything' }, undefined,
  { summary: 'x', billingAmounts: { charged: null, contract: null } });
check('classify-fail escalated', r.escalated === true, r.escalationReasons);
check('classify-fail fallbackUsed', r.fallbackUsed === true, r.fallbackUsed);
check('classify-fail queue=Escalation', r.queue === 'Escalation / Human Review', r.queue);
check('classify-fail category null', r.category === null, r.category);
check('classify-fail reason names Classify',
  r.escalationReasons.some((x) => x.includes('unparseable') && x.includes('Classify')), r.escalationReasons);
check('classify-fail no duplicate lowconf reason',
  !r.escalationReasons.some((x) => x.includes('Low confidence')), r.escalationReasons);

// Rule 0: Enrich chain failed -> human review, classification preserved
r = mk({ source: 'email', rawMessage: 'bulk export please' },
  { category: 'Feature Request', priority: 'Low', confidence: 0.95 }, undefined);
check('enrich-fail escalated', r.escalated === true, r.escalationReasons);
check('enrich-fail reason names Enrich',
  r.escalationReasons.some((x) => x.includes('Enrich')), r.escalationReasons);
check('enrich-fail suggestedQueue preserved', r.suggestedQueue === 'Product', r.suggestedQueue);
check('enrich-fail delta null', r.billingAmountDelta === null, r.billingAmountDelta);
check('enrich-fail identifiers []', Array.isArray(r.identifiers) && r.identifiers.length === 0, r.identifiers);

// Rule 0: category present but confidence missing -> treated as failure, not as 0 confidence
r = mk({ source: 'email', rawMessage: 'hello' }, { category: 'Bug Report', priority: 'High' },
  { summary: 'x', billingAmounts: { charged: null, contract: null } });
check('missing-confidence escalated', r.escalated === true, r.escalationReasons);
check('missing-confidence reason=unparseable',
  r.escalationReasons.some((x) => x.includes('unparseable')), r.escalationReasons);
check('missing-confidence no lowconf reason',
  !r.escalationReasons.some((x) => x.includes('Low confidence')), r.escalationReasons);

// Failed classify still applies the keyword backstop
r = mk({ source: 'email', rawMessage: 'total outage right now' }, undefined,
  { summary: 'x', billingAmounts: { charged: null, contract: null } });
check('classify-fail + keyword: both reasons', r.escalationReasons.length === 2, r.escalationReasons);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
// ,
// {
//   "id": "msg-002",
//   "source": "web_form",
//   "receivedAt": "2026-07-08T13:14:00Z",
//   "rawMessage": "We'd love to see a bulk export feature for our audit logs. We're a compliance-heavy org and this would save us hours every month."
// },
// {
//   "id": "msg-003",
//   "source": "support_portal",
//   "receivedAt": "2026-07-08T13:27:00Z",
//   "rawMessage": "Invoice #8821 shows a charge of $1,240 but our contract rate is $980/month. Can someone look into this?"
// },
// {
//   "id": "msg-004",
//   "source": "email",
//   "receivedAt": "2026-07-08T13:41:00Z",
//   "rawMessage": "I'm not sure if this is the right place to ask, but is there a way to set up SSO with Okta? We're evaluating switching our auth provider."
// },
// {
//   "id": "msg-005",
//   "source": "web_form",
//   "receivedAt": "2026-07-08T13:55:00Z",
//   "rawMessage": "Your dashboard stopped loading for us around 2pm EST. Checked our end — it's definitely on yours. Multiple users affected."
// },
// {
//   "id": "msg-006",
//   "source": "support_portal",
//   "receivedAt": "2026-07-08T14:08:00Z",
//   "demoExtra": true,
//   "rawMessage": "Hi — honestly not sure who to send this to. Ever since something changed on our account recently, a few things feel off: a report I used to pull isn't where I expect it, and I have a feeling our latest charge looked different too. Might all be unrelated, might be nothing. Can someone point me in the right direction?"
// }