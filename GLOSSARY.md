# Glossary

One meaning per term, and the one place that owns it. When guidance elsewhere disagrees, the owner wins; fix the other file.

| Term | Meaning | Owner |
|---|---|---|
| Herdr | The upstream software only: herdr-core and the Herdr app. | [VISION](VISION.md#where-things-live) |
| the Herdr system | Herdra's own project: widgets, protocol, guidance. | [VISION](VISION.md#where-things-live) |
| herdr-core, `hc` | The engine: terminals, children, machines. | `hc --skill` |
| Herdr app, `herdr-app` | The window, a client of `hc`: spaces, tabs, layouts, mods. Its `~/.config/herdr-app/AGENTS.md` is generated upstream reference, rewritten on every start. | `herdr-app --skill` |
| machine, core | A computer with its own `hc` core; others are listed by `hc machine ls` and addressed `machine/tNN`. | `hc --skill` |
| space | A place for one project's work on one machine. | `herdr-app --skill` |
| tab | One piece of work in a space: `main` for the Ceph, one per manus. | `herdr-app --skill` |
| terminal | An `hc` process with an address (`tNN`) and optional name. | `hc --skill` |
| pane | A terminal or mod on screen in the Herdr app. | `herdr-app --skill` |
| Herdra | The one master agent, and the Ceph of its own project. | [VISION](VISION.md#the-body) |
| Ceph | A project's main agent, in its space's `main` tab. | [VISION](VISION.md#the-body) |
| manus | A long-running Pi tab in a project's space that carries one track (started with `manus_start`). | [VISION](VISION.md#the-body) |
| track | One multi-step unit of work (a topic or a Task) that a manus carries. | this file |
| dendra | A child agent: a helper or a Worker. | [VISION](VISION.md#the-body) |
| helper | A read-only dendra: `scout`, `researcher` or `reviewer` (started with `dendra_start`). | `agency` skill |
| Reviewer | A helper on the `reviewer` profile, on the opposite company's model. | `agency` skill |
| Worker | A dendra for one Tandem root Task or a Task-free brief, in its own checkout (`dendra_start {kind: worker}`). | `agency` skill, pi-herdr README |
| inbox, `agent_send` | The one durable mailbox between agents; kinds `request`, `result`, `blocked`; `reply_to` closes a request. | pi-herdr README |
| report | A helper's final answer to its parent (`report`). | pi-herdr README |
| handoff | A Worker's typed outcome: plan, question, ready or error. | pi-herdr README |
| Task, subtask, Epic | Tandem's work records; a Worker takes a whole root Task; an Epic needs Algorant's approval. | `tandem` skill |
| board, logs | Active Tandem records, and completed or cancelled ones (read-only to agents). | `tandem` skill |
| worktree, checkout | A Worktrunk-managed git worktree for one track or Worker. | `worktrunk` skill |
| open item | A promise to Algorant or a decision he owes (`bin/herdra-open`); requests stay in the inbox. | [AGENTS](AGENTS.md#tracking-open-items) |
| projectify | Starting or opening a project, its space and its Ceph (`ceph_start`). | `projectify` skill |
| scriptify | Handing Algorant a reviewed script to run (`scriptify` tool). | `scriptify` skill |
