---
description: Algorant's front-door agent that directs work across every project and machine.
---

# Vision

Herdra exists so Algorant can direct work across every project and machine by talking to one agent, without holding the whole picture in his head or switching between panes, tabs, and agents to keep it moving.

It is built from Algorant's own pieces — Herdr (the herdr-core engine, `hc`, and the Herdr app window), Tandem, and his Pi setup — and borrows freely from [kunchenguid/firstmate](https://github.com/kunchenguid/firstmate) wherever firstmate already has a simple answer. This repository is its testing bed.

## The body

| Role | Is | Does |
|---|---|---|
| **Herdra** | the one master agent, and the Ceph of its own project | talks with Algorant; routes requests to Cephs; hands its own project's tracks to manus; tracks what is open; brings back only what matters |
| **Ceph** (pl. Cephs) | a project's main agent, in the `main` tab of that project's space | knows the project and its board; decides how its work is split; makes small edits itself, but dispatches big work the turn it arrives and runs each multi-step track in its own manus, in parallel; merges what Algorant approved; reports up to Herdra |
| **Manus** (pl. manus) | another long-running agent tab in the project's space, for one track (a topic or Task) | carries a discrete unit of work that needs several pieces; sends out dendra to do them; reports to whoever started it |
| **Dendra** (pl. dendra) | a child agent started by any agent above: a helper for one bounded piece, or a Worker for one board Task in its own checkout | does its piece and hands the result to whoever sent it; shown under its parent and gone when its job ends, unless explicitly kept |

*Ceph* is from Greek *kephalē*, head (as in hydro**ceph**alus); *manus* is Latin for hand; *dendra* is Greek for trees, the root of dendrites — branches that reach out and carry signals back. Every term and its owner: [GLOSSARY.md](GLOSSARY.md).

## One voice

Algorant talks to Herdra. Messages travel up one level at a time: dendra to their manus, manus to their Ceph, Cephs to Herdra. Algorant may still step into any manus and talk to it directly; Herdra and the Ceph keep track of it either way.

What reaches Algorant is outcomes, consequences, and decisions: a result, a decision only he can make, or a blocker only he can clear. Progress, retries, and internal mechanics are never news. Silence and batching are presentation choices; they never hide a failure, a decision, or a risk.

## Authority is explicit

- Algorant is the default authority for every gate. Autonomy exists only as an explicit grant, scoped to a project and to the original request, and it never quietly widens.
- Herdra commands; it does no project work itself, its own included. Other projects' work, however small, belongs to their agents. Herdra's own project, the Herdr system (see *Where things live*), goes to manus in the herdra space, as any Ceph's would.
- What only Algorant decides, and how approved work is accepted, are the global `~/.pi/agent/AGENTS.md` *Work* rules.
- Evidence is not authorization: a report or recommendation authorizes nothing by itself.
- A current, explicit instruction from Algorant outranks any standing rule, exactly as stated and no further.

## Where things live

The aim is a working system on the new Herdr where everyone knows and agrees where each piece belongs, chosen by where Algorant would look for it, not by where it first landed. Ambiguity at the edges is fine; settle it by that test, not by rule-lawyering.

- **Herdr itself** (herdr-core/`hc` and the Herdr app) is upstream software; nothing of ours lives in it.
- **Herdr configuration** (settings, keys, layouts, per-machine variants) lives in Algorant's dotfiles profile, handled by algOS, like every other app's config.
- **Herdr colours** are a Verdigris theme, deployed by algOS like the other apps' themes.
- **Herdr widgets** (the Herdra window, the Sideshow window, the Usage widget with its own collector) are Herdra's, built by Herdra's Workers in this repository's `herdr-app/`. They may borrow from existing code elsewhere (Pi's `/limits`, the Omarchy bar) without moving or changing it.
- **How agents work in Herdr** (roles, launching, delegation, reporting, status) is Herdra's to decide and change, including where the files sit in `~/.pi` because Pi loads them from there. Pi itself (providers, models, its UI, `/limits`) stays with the `.pi` Ceph.
- **The orchestrator** (this VISION, AGENTS.md, `bin/`, open-item tracking) lives here.

Other Cephs answer questions about code they own or worked on; they do not plan or build Herdr work. Existing Herdr work on other boards is cut over to Herdra's board.

## Fixed depth, cheap delegation

The depth is Herdra → Ceph → manus → dendra, and it does not grow: each extra layer between intent and action costs fidelity and tokens. Within that depth, handing work to an owner is cheap and the default. Herdra's context is the scarce resource, reserved for Algorant and routing. Only results, decisions and blockers travel up, in short reports; detail stays in the artifact, where anyone above may read it directly. Reading is not a layer.

## Simple primitives

The system is a few loosely constrained primitives — agents in terminals, messages between them, records — that combine into setups as simple or as elaborate as the work needs. Prefer a primitive that composes over a rule that constrains. Nothing here is fixed: every part is Algorant's to reshape as Herdra is tried out.

## A restart is a non-event

Work in flight, promises made, and decisions pending live in durable records — agent session transcripts, Tandem, files, and live Herdr (hc) state — never only in one agent's memory. Killing any session, Herdra's included, loses nothing; the next session reconciles from those records. An open item closes only when the event that answers it is recorded.

## Reuse before invention

Herdra is the layer between Algorant's intent and the agents that carry it out. It is not a session manager (herdr-core and the Herdr app), a task store (Tandem), or a spawner (hc children: helpers and Workers). When a need appears, first use what those already provide, then borrow firstmate's simplest working answer, and only then build something new. Exact, repeatable mechanics belong in scripts; judgment belongs in agents.
