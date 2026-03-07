# Benji PRD v4
## A Personal Command Center Built on Craft Agents

**Status:** Draft  
**Platform:** Desktop first (Electron)  
**Base:** Forked from Craft Agents OSS  
**Primary Orchestrator:** OpenClaw  
**Primary Goal:** Personal command center for Hunter’s work with agents  
**Success Metric:** Useful now, great quickly, architecture can be ugly if the experience is excellent

---

# 1. Product Summary

## One-line promise

**Benji is a personal command center for working with your agents so you can wake up to completed work, review what matters, and move faster than anyone managing the same work manually.**

## Product framing

Telegram is where the user talks to their Claw on the go. Benji is where the work lives.

Benji is not a generic AI desktop. It is a custom command center for Hunter’s actual workflow and a force multiplier for how he works.

The product should create one core feeling: you open Benji and immediately see leverage.

Overnight, your agents moved work forward. When you open Benji, your `Agent` home shows what happened, what needs judgment, and what should move next. Throughout the day, you think directly in documents, review drafts and variants, validate ideas, turn conversations into PRDs, and launch coding work with full project context without leaving the command center.

Benji should support Hunter’s actual workflow:
- reviewing what agents completed overnight
- seeing what needs review, feedback, or decision
- giving feedback on drafts and research
- spinning up variants
- consolidating output into stronger final artifacts
- turning conversations into PRDs or implementation briefs
- launching coding work with context inside the app

Craft Agents gives Benji a head start on:
- Electron shell
- streaming session UX
- tool-step visibility
- diff review
- permissions/autonomy scaffolding
- background task infrastructure
- session persistence
- automation patterns

Benji then replaces the product model above that substrate with a project-centered workbench for active work.

---

# 2. Product Thesis

## The problem

The user’s current work with agents is fragmented:
- conversations happen in Telegram, ChatGPT, Claude, and other tools
- notes live separately from execution
- drafts and research appear in isolated chat threads
- coding agents are powerful but detached from the broader project context
- progress exists, but not in one command center where the user can review, refine, and launch the next step

## The bet

The fastest path to a great personal command center is not to build a desktop agent runtime from scratch.

The fastest path is to fork a strong agent desktop foundation and aggressively reshape it around the user’s actual workflow.

The deeper bet is experiential: if the user wakes up to real progress, reviews only what requires human judgment, and can immediately redirect agents from the context of living project workspaces, they will operate at an unfair speed compared with someone managing the same work manually.

## Product thesis

Benji wins by using Craft Agents as the runtime and interaction substrate while replacing its top-level ontology with Hunter’s own work model:
- projects as workbenches
- notes as the thinking surface
- tasks as durable work units
- runs as visible agent execution history
- artifacts and variants as reviewable outputs
- embedded coding sessions as execution surfaces

The value is not just organization. The value is leverage: Benji should help the user review, refine, and execute significantly more work by turning agents into an active operating layer rather than isolated chat tools.

---

# 3. Product Principles

## 3.1 Optimize for personal utility over architectural purity
The product does not need to be clean enough for a public launch. It needs to be powerful, legible, and useful now.

## 3.2 Keep Craft’s machinery, replace Craft’s nouns
Craft’s streaming, session, permission, and diff infrastructure are valuable. Its session-first product model is not the desired end state.

## 3.3 Benji is a command center, not a chat app
The center of the product is reviewing, directing, refining, and executing work with agents.

The product should feel like the user is managing momentum, not starting from zero.

## 3.4 Projects must feel like workbenches
Open a project and the work is already spread out in front of you.

A project should feel like a live operating surface for meaningful work, not a filing cabinet of related objects.

## 3.5 Notes are where thinking starts
Tasks, agent runs, feedback, and coding execution all emerge from documents.

The note editor must feel first-class and fluid enough that the user wants to think there directly, not just store finished output there.

## 3.6 Everything important should remain inspectable
Agent work should be visible, reviewable, and linked to its originating task or document.

## 3.7 Embedded execution beats external handoff by default
Coding work should usually start inside Benji via embedded CLI sessions rather than kicking the user into a separate app.

The user should feel like execution is one more layer of the same project workspace, not a context switch into another universe.

---

# 4. Core User Narrative

You wake up, make coffee, and open Benji.

Your Agent home is already waiting. It does not feel like a dashboard. It feels like leverage.

Overnight, your agents did real work. OpenClaw validated an idea, drafted a research memo, and pushed two tasks forward. A services-page draft is waiting for your review. Another project is blocked on a decision only you can make. One coding run prepared an implementation plan from the PRD you drafted yesterday.

You are not starting from zero. You are stepping into momentum.

You open a project and everything that matters is already there. The living document is in the center. Inline tasks sit inside it. Agent output appears where it matters. A live pulse shows what changed, what is still running, and what needs your judgment. The project feels like a workbench, not a drawer full of linked objects.

When you want to think, you edit directly in the document with a first-class writing experience. When you want leverage, you highlight a section and say: “Turn this into five stronger services-page directions.” Benji spins up variants. You compare them side by side, leave feedback inline, and tell Claw to consolidate the best ideas into one.

Then you say: “Turn this into a PRD.” The artifact appears inside the project. It is not lost in a chat transcript. It is now part of the work.

When it is time to execute, you click **Open in Codex** or **Open in Claude Code**. A coding panel opens inside Benji with the PRD, relevant notes, recent thread context, and repo metadata already loaded. The coding experience is rich and alive, but it happens from the context of the project itself.

That is the product feeling:

**Benji is where the user sees what happened while they were away, decides what matters, and sends their agents back to work with sharper direction than anyone managing the same work manually.**

**Telegram is where you talk to your Claw. Benji is where your Claw works.**

---

# 5. Goals and Non-Goals

## Goals
- Get to a great personal command center quickly by building on Craft Agents
- Preserve Craft’s strongest interaction patterns for threads and coding sessions
- Replace Craft’s session-first information architecture with a project-centered workbench
- Make review, refinement, and execution the core workflow
- Support a file-first workspace for durable user-owned content where practical
- Let OpenClaw orchestrate the user’s work inside the app
- Support embedded coding sessions launched directly from project context
- Help the user open into leverage, not empty dashboards
- Help the user operate at an unfair speed by reviewing only what needs human taste, judgment, or decision

## Non-goals
- Launching a polished public SaaS in v1
- Full architectural purity before utility
- Supporting every provider equally as a product goal
- Treating Craft’s existing ontology as sacred
- Rebuilding Craft’s mature runtime UX from scratch without reason

---

# 6. What Benji Inherits from Craft Agents

Benji should deliberately inherit the following systems or patterns from Craft Agents where doing so accelerates delivery:

## 6.1 Desktop substrate
- Electron shell
- renderer/main process structure
- existing session and paneling infrastructure
- desktop UX conventions already solved by Craft

## 6.2 Agent interaction quality
- live streaming responses
- readable markdown rendering
- tool-step visualization
- long-running task/session progress visibility
- strong diff and artifact inspection patterns

## 6.3 Runtime and persistence patterns
- session persistence
- background task machinery
- event-driven automation patterns
- local configuration and workspace runtime state
- permission/autonomy scaffolding

## 6.4 What Benji should NOT inherit as product truth
- session-first ontology
- source/provider configuration as primary user-facing structure
- multi-session inbox as the main home screen
- generic agent cockpit framing

---

# 7. What Benji Replaces in Craft Agents

## 7.1 Information architecture
Craft’s default top-level model should be replaced with Benji’s own top-level model.

Preferred top-level navigation:
- Agent
- Projects
- Tasks
- Notes
- Threads
- Queue
- Settings

Optional structural views may still exist for sessions, sources, or runtime inspection, but they should not dominate the user experience.

## 7.2 Default landing experience
Craft’s multi-session/home experience should be replaced by an Agent home and project-driven workflow.

## 7.3 Primary work object
Craft centers sessions. Benji centers:
- project workspace
- artifacts and drafts under review
- tasks and runs
- embedded execution

## 7.4 Product language
Replace Craft language in the UI with Benji language wherever possible:
- session → run or thread where appropriate
- workflow status → run/task state where appropriate
- source → context or linked material where appropriate
- workspace → project or command center depending on context

---

# 8. Core Concepts

## 8.1 Project
A project is a living workspace canvas where the user and their agents actively build something together.

A project should feel like a workbench, not a filing cabinet.

A project canvas is the default view inside a project. It is not a folder browser, a session detail page, or a set of disconnected tabs. It is the live work surface where the project's central document, related tasks, thread context, run history, and next execution affordances appear together.

The project canvas should include:
- a living document as the primary thinking surface
- inline tasks
- active and historical runs
- contextual thread activity
- artifact and draft review surfaces
- a project pulse showing what changed, what is running, and what needs review
- a code panel that can open from any task, document section, or artifact
- linked repos as implementation context

## 8.2 Note / Living Document
A note is a markdown-based thinking surface. In practice, many projects will have a home document that acts as the project’s central working document.

Tasks, feedback, runs, and artifacts should be attachable or embeddable in the document where relevant.

## 8.3 Task
A durable unit of work.

A task may emerge from a document, be created directly, or be created from a conversation or Telegram message.

A task should answer:
- what needs to happen
- who is responsible
- what runs have already happened
- what artifacts or outputs exist

## 8.4 Run
A run is a visible execution attempt by Claw, a subagent, or a coding agent to move a task or artifact forward.

Runs should capture:
- status
- progress
- findings
- outputs
- artifacts
- linked session information
- review state

## 8.5 Artifact
An artifact is a reviewable output produced by the user or an agent.

Examples:
- research memo
- services page draft
- PRD
- validation report
- implementation brief
- generated variants

Artifacts should be first-class in the review flow.

## 8.6 Variant
A variant is an alternate version of an artifact or subsection of work.

Examples:
- five homepage draft directions
- multiple positioning options
- alternate service page structures
- several PRD outlines

Variants must be easy to compare, comment on, and consolidate.

## 8.7 Thread
A thread is the durable collaboration history around a part of the work.

Threads should usually appear in context, attached to a document section, artifact, task, or run.

## 8.8 Coding Session
A coding session is a contextual execution surface, usually embedded in the project’s code panel. It should be launched from a task, document section, run, or artifact and inherit relevant context automatically.

## 8.9 OpenClaw
OpenClaw is the primary orchestrator inside Benji. It should:
- read current project context
- evaluate notes/tasks/messages
- draft artifacts
- create variants
- consolidate feedback
- launch runs
- prepare or trigger coding sessions

---

# 9. Experience Model

## 9.1 Agent Home / Command Surface
The home screen should be `Agent`.

It should feel like Claw's operating surface: the user is stepping into momentum rather than opening a blank workspace.

It should show:
- work completed or advanced by agents
- drafts, research, or decisions waiting for review
- blocked work
- active runs
- suggestions for next actions
- recently active projects
- what specifically requires human judgment, taste, or decision

## 9.2 Project Workspace Canvas
The project workspace is the core surface of the app.

It should support:
- a center document canvas
- inline tasks and task states
- embedded runs and outputs
- contextual thread branches
- artifact and variant review
- project pulse/activity strip
- right-side context and code panel
- optional knowledge graph access showing how the project connects to broader notes and thinking

The user should not need to constantly click between note, task, thread, and session as separate drawers.

The project should feel like a live command center for one stream of work.

## 9.3 Review Flow
Benji should support a review loop where the user can:
- inspect agent output
- leave feedback inline
- request variants
- choose one direction
- ask Claw to consolidate
- turn the result into another artifact
- move seamlessly from review into execution

This should be a primary workflow, not a side feature.

## 9.4 Compare and Consolidate
When Claw produces multiple versions, the user should be able to:
- compare them side by side
- comment on each
- select favorite elements
- ask Claw to merge the best parts into one

## 9.5 Embedded Coding Flow
From a document, task, or artifact, the user should be able to click **Open in Codex** and start an embedded coding session inside Benji.

That session should inherit:
- task context
- linked artifact or PRD
- document context
- recent thread summary
- linked repo metadata

---

# 10. File-First vs Craft Runtime Model

Because Benji is built on Craft, there will be two layers:

## 10.1 Craft runtime layer
This includes:
- session management
- streaming infrastructure
- tool execution visibility
- runtime state
- permissions/autonomy logic
- existing Electron application shell

## 10.2 Benji workspace layer
This includes the user-facing work model:
- project home documents
- notes
- tasks
- runs
- artifacts
- variants
- linked repos
- review queue

## 10.3 Product rule
Craft may remain the runtime substrate, but Benji’s workspace model should become the user-facing truth.

---

# 11. Information Architecture

## Primary navigation
- Agent
- Projects
- Tasks
- Notes
- Threads
- Queue
- Settings

## Within a project
- Canvas (default)
- Notes
- Tasks
- Threads
- Artifacts
- Repos
- History / Activity

Craft-native structural views for sessions or sources may remain available for debugging, recovery, or advanced inspection, but should be hidden or demoted from the default experience.

---

# 12. OpenClaw Behavior Model

## 12.1 Role
OpenClaw is the primary orchestrator for the user’s work.

It should:
- observe new notes, tasks, messages, and artifacts
- classify new work
- create variants when asked
- consolidate feedback
- prepare drafts and PRDs
- recommend or trigger runs
- launch coding work from context

## 12.2 Product examples
Examples of natural user interactions:
- “Turn this into a new draft of the services page.”
- “Spin up five different versions.”
- “Validate these ideas.”
- “Turn this conversation into a PRD.”
- “Open this in Codex.”

## 12.3 Reviewable output rule
When OpenClaw produces meaningful work, it should usually appear as an artifact or run output that the user can inspect, refine, or approve.

---

# 13. Task and Run Model

## 13.1 Tasks
Tasks are durable work units and may originate from:
- inline document tasks
- direct task creation
- Telegram inputs
- conversation-derived work

## 13.2 Runs
Runs are attached to tasks and represent agent execution history.

Run states may include:
- queued
- preparing
- running
- awaiting_review
- blocked
- completed
- failed
- cancelled

## 13.3 Why runs matter
Runs let the user see:
- what the agent did
- what it found
- what it produced
- what is still in progress
- what needs review

This makes work visible instead of mysterious.

---

# 14. Artifacts and Variants

## 14.1 Artifact types
Benji should support artifacts such as:
- research
- marketing copy
- strategy doc
- PRD
- implementation brief
- validation memo
- code plan

## 14.2 Variant workflows
For any artifact, the user should be able to ask for multiple variants.

The review experience should support:
- compare
- comment
- select
- consolidate

## 14.3 Artifact lifecycle
An artifact may move through states such as:
- drafted
- reviewing
- revising
- approved
- handed_off_to_execution

---

# 15. Embedded Coding Sessions

## 15.1 Default behavior
By default, **Open in Codex** should open an embedded Codex CLI session inside Benji, not eject the user into a separate app.

## 15.2 Why
This preserves the command-center experience:
- the document stays visible
- the task/run stays attached
- the project pulse remains visible
- code work streams back into the same workspace

## 15.3 Context package
Benji should automatically inject:
- linked PRD or artifact
- task details
- recent discussion summary
- project context
- repo metadata
- selected files or note sections when relevant

## 15.4 Optional external handoff
Benji may still support opening the Codex app as a secondary action for heavy dedicated coding work, but embedded execution is the default.

---

# 16. What to Reuse Directly from Craft Agents

These areas should be reused as directly as possible to accelerate delivery:

## 16.1 Streaming UI
Reuse and adapt Craft’s streaming response patterns.

## 16.2 Tool-step and action visibility
Reuse its strong visibility for what the agent is doing while translating the language into Benji’s run/task model.

## 16.3 Diff inspection
Reuse multi-file diff review patterns for coding sessions and run outputs.

## 16.4 Permissions model
Reuse permission/autonomy infrastructure and map it into Benji’s user-facing autonomy model.

## 16.5 Session persistence
Reuse Craft’s persistence and recovery patterns for long-running work.

## 16.6 Automation/event scaffolding
Reuse automation and event ideas where they help Claw react to project changes.

---

# 17. What to Override Quickly in the Fork

These things should be changed early so Benji stops feeling like a re-skinned Craft Agents build.

## 17.1 Sidebar / navigation
Replace session/source-centric nav with Benji’s own IA.

## 17.2 Landing screen
Replace generic session-centric home with Agent home and command-surface review.

## 17.3 Project default surface
Make project canvas the default entry point, not a list of sessions.

## 17.4 Language
Replace Craft terminology throughout the visible product.

## 17.5 Embedded artifact review
Add artifacts and variants as first-class review flows.

## 17.6 Embedded coding panel
Add the right-side coding panel launched from project context.

---

# 18. Implementation Plan

## Phase 1: Fork and reframe the shell
- fork Craft Agents
- rebrand the app internally as Benji
- replace primary navigation
- create Agent home landing surface
- add project canvas shell

## Phase 2: Introduce Benji work objects
- add project home document concept
- add task + run model
- add artifact + variant model
- attach runs and artifacts to tasks and documents

## Phase 3: Make projects feel alive
- add project pulse/activity strip
- show active runs inline
- embed contextual threads in documents
- create review queue for drafts and outputs

## Phase 4: OpenClaw orchestration
- wire OpenClaw into project context
- support “turn this into a draft,” “make variants,” “consolidate,” and “make a PRD” actions
- connect Telegram inputs into the same work graph

## Phase 5: Embedded coding
- create code panel in project workspace
- add Open in Codex action
- launch embedded Codex CLI sessions with context package
- attach coding session progress back to runs and project activity

## Phase 6: Polish for daily use
- refine review flows
- improve compare/consolidate UX
- tighten command center experience
- trim any remaining Craft-native surfaces that cause confusion

---

# 19. Acceptance Criteria

## Agent home test
When the user opens Benji in the morning, they can immediately see:
- what agents completed
- what is waiting for review
- what is blocked
- what can be pushed into execution

## Project workbench test
Opening a project feels like opening a living workbench rather than browsing folders.

## Draft/refinement test
The user can ask for multiple variants of a draft, compare them, give feedback, and consolidate them into one.

## PRD generation test
The user can ask OpenClaw to turn a conversation, idea, or artifact into a PRD.

## Embedded coding test
The user can click Open in Codex and start a contextual coding session inside the app with the relevant PRD and project context already loaded.

## Craft replacement test
Benji no longer feels like Craft Agents with new colors. It feels like a custom command center built for the user’s workflow.

---

# 20. Summary

Benji is not a generic AI desktop.

It is a personal command center for Hunter’s work with agents, built pragmatically on top of Craft Agents so it can become useful fast.

Craft provides the machinery: Electron shell, streaming, sessions, diffs, permissions, background work, and runtime persistence.

Benji provides the real product shape: project workbenches, living documents, tasks, runs, artifacts, variants, review flows, knowledge graph context, and embedded coding execution.

The product promise is leverage. The user should wake up to completed work, review only what needs human judgment, refine outputs in context, and move instantly into execution.

The result should feel simple and powerful:

**Benji is where the user sees what happened while they were away, decides what matters, and sends their agents back to work with sharper direction than anyone managing the same work manually.**

**Telegram is where you talk to your Claw. Benji is where your Claw works.**
