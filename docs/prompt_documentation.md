# Prompt Documentation

The assignment asks for each prompt plus a one-paragraph explanation of its structure, tradeoffs, and what I would change with more time. Prompts are listed in the order they were used.

Two Claude models split the work by strength. Fable, the stronger reasoner, did the planning and every review; Opus 4.8 did the building. That split runs through the whole process below. Fable decides what should be built and whether what was built is correct, and Opus 4.8 writes it.

The prompt blocks are reproduced exactly as they were sent, punctuation and typos included.

---

## Prompt 1: Planning prompt (plan before build)

Run on Fable in the first session, in a directory containing only the assignment docx. Planning is where reasoning depth pays off most, so it got the stronger model. It produced `CLAUDE.md` (persistent project memory) and `plan.json` (the task queue) that every later session worked from.

```
You are working in a directory that contains exactly one file: AI_Engineer_Technical_Intermediate-Senior.docx. This is a technical assignment from a company I'm applying to. Your job in THIS session is to plan, not to build.

Step 1 — Read the assignment
Extract and read the full content of the docx (use pandoc, python-docx, or docx2txt — install if needed). Do not skim. Identify: the exact deliverables, tech stack requirements or constraints, evaluation criteria, deadlines, and anything ambiguous or underspecified. List any ambiguities explicitly.

Step 2 — Create CLAUDE.md
Create a CLAUDE.md file at the project root that will serve as persistent project memory for all future Claude Code sessions. It must contain:
- ## Assignment Summary: a faithful, condensed summary of what the company is asking for (requirements, deliverables, constraints, evaluation criteria)
- ## Architecture & Tech Decisions: initially the proposed stack and key design choices, with a one-line rationale each
- ## Conventions: code style, folder structure, naming, testing approach to follow
- ## Progress Log: a running log; every future session must append what was done, decisions made, and what's next
- ## Open Questions / Risks: ambiguities in the assignment and how we chose to interpret them
Instruction for all future sessions: always read CLAUDE.md first, and always update the Progress Log and mark tasks done in plan.json before ending a session.

Step 3 — Create plan.json
Create plan.json: a complete execution plan to build the assignment. Structure it as 4–6 phases, each with multiple tasks. Use exactly this schema:

{
  "project": "<name>",
  "goal": "<one-sentence goal from the assignment>",
  "phases": [
    {
      "phase_id": 1,
      "name": "<phase name>",
      "objective": "<what this phase achieves>",
      "tasks": [
        {
          "task_id": "1.1",
          "name": "<task name>",
          "objective": "<what this task accomplishes and why>",
          "agent_prompt": "<a complete, self-contained prompt that a coding agent can execute for this task — include context, exact files to create/modify, acceptance criteria>",
          "expected_output": "<concrete artifacts/behavior expected when done>",
          "depends_on": ["<task_ids>"],
          "done": false
        }
      ]
    }
  ]
}

Requirements for the plan:
- Phases should follow a realistic build order (e.g., setup & scaffolding → core backend/AI logic → integration → testing & evaluation → documentation & polish), adapted to what the docx actually asks for.
- Every agent_prompt must be self-contained: an agent seeing only that prompt plus CLAUDE.md should be able to complete the task.
- Include tasks for testing, a README, and anything the assignment's evaluation criteria mention.
- "done" starts as false everywhere; future sessions flip it to true as tasks complete.

Step 4 — Report back
After creating both files, give me: a short summary of the assignment as you understood it, the phase list, and any ambiguities I should clarify with the company before building.
```

**Why it's structured this way.** The whole prompt hangs on one constraint: plan, don't build. A coding agent told to "do the assignment" starts writing files in the first minute and finds out what it missed hours later. Forcing a full read of the docx and an explicit ambiguity list first surfaced the decisions that mattered (what does "billing error > $500" mean, is confidence self-reported or calibrated) while they were still cheap to settle. The rest of the structure is about context preservation across sessions. `CLAUDE.md` holds the durable facts, `plan.json` holds the work queue, and every task carries a self-contained `agent_prompt`, so a later session can execute task 2.4 knowing nothing but that task and `CLAUDE.md`. There is no transcript to carry and nothing that can be summarized away. Working phase by phase, task by task also narrows the hallucination surface: a prompt scoped to one concrete task with named files and acceptance criteria leaves little room to invent, where "build the pipeline" invites plausible-looking components that don't exist. The tradeoff was time. Planning ate roughly the first hour of a 3 to 5 hour timebox, and the plan was still wrong once, since it specified a hand-written code pipeline that was later swapped for n8n. Only the phases needed rewriting, because the assignment analysis carried over. With more time I'd make each task's `done` flag earned rather than asserted, by adding an acceptance-criteria field naming the exact command that proves the task works, and I'd split the ambiguity list into its own file with a decision and date per entry so interpretations stay traceable.

---

## Prompt 2: Grilling prompt (interrogate the plan before building)

Given to the coding agent after the plan existed but before any building started. `/grill-me` is a skill that flips the usual direction of a session. Instead of me prompting the agent, the agent interviews me, question by question, about the plan, and doesn't stop until every open branch of the decision tree has an answer.

```
/grill-me please use claude.md , plan.json as well as AI_Engineer_Technical_Intermediate-Senior.docx to ask me questions to know better about the project and it needs 
```

**Why it's structured this way.** A plan written by an AI still contains the AI's silent assumptions, and I had my own that I hadn't said out loud. The grill session exists to force both into the open before they turn into built code. Pointing the skill at all three sources, `CLAUDE.md` (what we decided), `plan.json` (what we're about to build), and the assignment docx (what was actually asked), makes the agent cross-examine them against each other and turn every gap into a direct question. Anywhere the plan under-specified the assignment, or the assignment allowed more than one reading, I had to give an explicit answer. The session settled eight decisions that would otherwise have been guessed mid-build, among them the real deadline, the priority of each sample message, how the low-confidence fallback gets demonstrated (a sixth synthetic message rather than rigging a real one), the exact record shape, and keeping escalation keywords literal. The payoff is mutual understanding. After this session the agent knew what I wanted and I knew what it was about to build, so later sessions executed instead of interpreting. The cost is that it's an interview, not automation. It took a focused block of my time answering questions one at a time, and the outcome is only as good as my answers. With more time I'd run a second, shorter grill after the first live run, because some assumptions only become visible once real data flows through the pipeline.

---

## Prompt 3: Execution prompt (one task, one review gate)

Given at the start of every build session, after prompts 1 and 2 had produced and hardened `plan.json`. It drives the implement, review, revise loop, and it is where the two models meet. Opus 4.8 executes the tasks, and Fable reviews each one and is never allowed to write code.

```
Read plan.json, which contains a development plan organized into phases, each containing tasks.
Implement the plan one task at a time, following this exact workflow for every task:

1. Implement the current task fully, according to its description in plan.json.
2. Request review: when the task is complete, ask the Fable model to review your work. Provide
   Fable with the task's requirements from plan.json and a summary of what you implemented
   (including relevant files/changes), so it can verify the implementation matches what was asked.
3. Handle feedback:
   - If Fable approves, mark the task as done and move to the next task.
   - If Fable has comments or objections, revise your implementation based on that feedback,
     then submit it to Fable for review again.
4. Repeat the revise-and-review cycle for the same task until Fable explicitly approves.
   Do not move to the next task without Fable's approval.

Additional rules:
- Never skip a task or work on multiple tasks in parallel.
- Never self-approve; only Fable's explicit approval unblocks the next task.
- Respect the order of phases and tasks as defined in plan.json.
- After each approval, briefly state which task was completed and which task you are starting
  next, so progress is easy to track.
- If a task is ambiguous or conflicts with earlier work, raise the issue with Fable during
  review rather than guessing silently.
```

**Why it's structured this way.** An AI checking its own work approves it. So the work splits across two models: Opus 4.8 implements, and Fable, which wrote the plan and writes no code, reviews. Fable reviewing a plan it authored is deliberate; it knows each task's intent, so it catches an implementation that satisfies a task's words while missing its point. Per task, Fable gets the requirements straight from `plan.json` plus a summary of what was built, and answers one question: does this match what the plan asked for? The check runs against our criteria, not the implementer's reading of them.

"Never self-approve" makes this a hard gate. A task's `done` flag flips only on Fable's explicit approval; on objection the implementer revises and resubmits the same task, as many rounds as needed. One task at a time matters equally, because a reviewer handed one node and its tests can actually check them, while a reviewer handed the whole pipeline nods along. The gate caught real defects before anything ran: `toUnix()` where `toMillis()` belonged, a missing `=` expression prefix on both LLM prompts, unsafe `.item` references, and sample answers pasted into the classify prompt.

The cost is speed, since every task pays a review round-trip inside a 3 to 5 hour timebox, and the gate is only as honest as the implementer's summary. Fable judged a written description of a node's configuration, not the node. A summary that quietly omits a wrong field name still reads as correct, and prose checked against prose can never catch that. With more time I'd replace the model-versus-model check with real testing. I'd give the reviewer the n8n MCP connection from the start so it runs the workflow and reads live executions instead of trusting a report, which is exactly what the MCP later proved useful for (prompt 4). On top of that I'd build Claude testing agents that exercise the pipeline the way it will actually be used: feed it real inbound messages, then judge every output against the sources of truth we already maintain, meaning the requirements in `CLAUDE.md`, the task criteria in `plan.json`, the project memory, and the docs. Each task's gate then becomes a simulation of the flow rather than an argument about a summary, and the agents keep running as a regression suite whenever a prompt or node changes.

---

## Prompt 4: n8n MCP hookup and live debugging

Used once the workflow was imported and running. After enabling n8n's MCP server from the n8n website, two prompts wired the agent to the live instance and put it to work.

```
this is the n8n MCP connection server and config, please connect and save in memory that we
have it, so we can use it for debugging and for adding new flows.

{
  "mcpServers": {
    "n8n-mcp": {
      "type": "http",
      "url": "http://localhost:5678/mcp-server/http",
      "headers": {
        "Authorization": "Bearer <REDACTED: n8n MCP access token>"
      }
    }
  }
}
```

```
please debug using the n8n mcp what is going wrong
```

**Why it's structured this way.** The MCP gives the agent direct access to the running n8n instance: run the workflow, read real executions, confirm rows landed where they should. Asking it to connect and remember keeps the channel alive across sessions, so the second prompt needs no detail. It caught the Groq 429 rate-limit errors (a tokens-per-minute cap, fixed with a throttle in the feeder script) and Sheets rows written to the wrong tab. MCP stays the agent's read-and-debug channel; credentials, tab selection, and publishing stay mine in the n8n UI. The bearer token controls the whole instance, so it lives in local config only, never the repo, and gets rotated. With more time I'd automate the checks the MCP already makes possible: pin the LLM nodes to replay routing and escalation against known outputs on every change, and give each new flow its own agent that runs it, reads the execution, and judges the result against `plan.json`.

