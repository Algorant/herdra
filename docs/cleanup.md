# On-demand cleanup, with the how

> This is the author's own runbook and depends on his private Pi scripts (`~/.pi/agent/scripts/*`, `~/scripts/agent-sync`).

Run `bin/herdra-tidy` when Algorant asks what is heavy, before proposing a cleanup, or after an approved cleanup to measure its actual effect. Nothing runs on a schedule. This is a read-only Linux snapshot, not permission to act.

```sh
bin/herdra-tidy
bin/herdra-tidy --pi herdra
bin/herdra-tidy --json
bin/herdra-tidy --agents            # every agent tab, every project space: keep, close or ask
```

Use the largest measured **Pi PSS**, not summed RSS, to choose a candidate. Additional OS descendant PSS is separate; native Pi rows must not be counted again as descendants. A large transcript is not the active model context or a prediction of reclaimable RAM. Physical entries include old branches and compacted history. File mtime is recorded file-write activity, not last human input. Unknown/inaccessible/racing observations stay unknown. Remote rows need a report run by their owner on that host; never apply a local PID/path to another machine.

Review thresholds (not eviction rules): PSS ≥350 MiB, transcript ≥25 MiB, or ≥10,000 physical entries; old means ≥14 days and ≥10 MiB; quiet means ≥24 hours without a transcript write while not working. A working/blocked Pi, unsettled children or uncertain identity means **defer**, not interrupt. Native `done` proves neither accepted work nor a safe close.

## Agent tabs: keep, close or ask

A Ceph runs this for its own space and Herdra for all of them, so neither has to remember what tabs are open:

```sh
bin/herdra-tidy --agents
bin/herdra-tidy --agents --space herdra
bin/herdra-tidy --agents --close
```

One line per tab in every space of the Herdr app on every connected machine (`herdr-app ls`, then `hc ls`/`hc get` for who a terminal is), then one summary line:

- **keep** — Herdra, each space's `main` Ceph, `tandem` tabs, plain shells, a Pi whose status is working, blocked or unknown, a Pi with live child terminals, and any agent whose checkout has uncommitted changes, unmerged commits, or a state that could not be read.
- **close** — any other idle or done Pi agent whose session is saved and whose checkout is clean with its branch already merged. Work delivered and waiting for Algorant is closeable: the Task, post and research file carry it, and the session restarts from its saved file.
- **ask** — a Pi with no parent, starter, task or kind label and no known role, or a program that is neither a Pi nor a known shell. Its provenance is unknown, so it is listed for a person to identify and is never closed automatically.

A tab with several terminals takes the strongest of them (`keep` beats `ask` beats `close`). Any Pi labelled a Ceph (kind or role `ceph`/`herdra`) or whose hc name is its space's name is kept wherever its tab sits and whatever that tab is called; a sole Pi in a space with no `main` tab is kept as that space's Ceph too. A space whose machine is not connected is printed as `not checked`, never guessed.

`--close` runs `herdr-app do tab.close --id <tab> --confirmed true` on the `close` lines only, then prints one summary (`closed · kept · ask · not checked`, plus `failed` with the reason on stderr and exit 1). It touches no session, worktree or branch: the Pi session stays in `~/.pi/agent/sessions/` and resumes with `pi --session`, and the branch stays where it was. Close the tab, not the work. Uncommitted or unmerged work is always a `keep`, so `--close` cannot strand it.

Cost: no model calls, no messages to owners, no new state file, timer or service. One `herdr-app ls`, one `hc ls`, one `hc get` per Pi tab outside `main`, and two or three `git` calls per candidate checkout (through `hc exec --on <machine>` for another machine). A full dry run over every space takes well under a second.

## Approval and preflight

1. Pick one finding. Establish its real owner using native metadata, then the owner's actual Worker/manus handoff and Task, not a terminal screen. Resolve current names at execution time.
2. Give the specific **before → after**, what might be freed, the risks, the check and the undo. Live-app changes require Algorant's approval first. Ownership and merge/discard approvals follow the global rules; a report does not grant them.
3. Use the finding's exact quoted target, not a wildcard or a PID copied from an old report. Re-run the narrowed report immediately before any approved action. If identity, state or ownership changed, stop and reassess.
4. Do not delete a transcript. Before a separate session-deletion proposal, use `~/scripts/agent-sync verify --older-than N`; if nonzero, push and verify again. Backup verification does not itself authorize deletion.

## Heavy Ceph or manus: preserve continuity first

**Frees:** potentially the outgoing Pi's heap and owned auxiliary processes. Transcript size alone does not quantify this. Compaction, `/reload`, resuming or forking the same journal is not a fresh-process RAM reset.

**Safe preparation now:** the finding supplies a narrowly scoped report command. Ask the current owner through `agent_send` to finish its current turn and prepare a handoff through the existing memory workflow. Record: current goal; exact approvals and Task references; scope/exclusions; Git/worktree state; pending inbox thread references and required replies; children/Worker references and their owners; artifacts; blockers; next step; old session path. Personal details stay in the vault. Read live Tasks and inbox records alongside the note.

For a target named `NAME`, inspect metadata without exposing its launch arguments:

```sh
hc get NAME --json | python3 -c 'import json,sys; d=json.load(sys.stdin); r={k:d.get(k) for k in ("address","name","pid","state","status","status_ms","parent","keep","rm")}; r["labels"]={k:v for k,v in (d.get("labels") or {}).items() if k in ("where","role","kind","starter","pi.session","pi.pgid","task")}; print(json.dumps(r,indent=2))'
~/.pi/agent/scripts/inbox open
```

`NAME` is a placeholder: use the exact shell-quoted address from the finding. Do not inject a message into a working agent merely because it is heavy. A manus belongs to its starter, not automatically to Herdra. Prefer to settle all children before rollover; if that is impossible, existing native adoption/recovery must prove their new owner first.

**Executable boundary:** only an idle Pi running inside an existing **interactive Bash or Zsh root terminal**, with **no live or unsettled owned children/jobs**, is eligible for the retained-shell recipe below. A shell script wrapper (`child-exit`, a Worker/manus launch), a direct Pi root, an ambiguous process association, a question or a working turn is **not** eligible. The report must distinguish these, not infer that `keep:true` will preserve a terminal after ordinary exit. Finish ready captured work through its existing lifecycle instead. In the disposable proof, an ordinary HC child disappeared during the exercise; its stored parent field did not establish survival. This recipe does not claim native Worker/session ownership adoption.

After the current owner confirms the handoff is durable and all owned jobs are settled, and Algorant approves the **specific** live replacement, use the finding's current exact address and working directory. The following is the exact recipe; replace the uppercase values with the finding/approved note, not guessed defaults:

```sh
# Record OLD_SESSION and OLD_PI_PID from the fresh report before exit.
TARGET='exact-native-address'
CWD='/absolute/verified/project-or-worktree'
HANDOFF='/absolute/existing/handoff-note.md'
NEW_ID=$(python3 -c 'import uuid; print(uuid.uuid4())')

# Only at its confirmed idle prompt, only on the specifically approved idle/no-child owner:
hc keys "$TARGET" ctrl+d
```

Before launching anything, run `hc get "$TARGET" --json` through the metadata whitelist above. Require **the same native address and root shell PID**, cleared Pi status/session/process-group labels and the old Pi PID absent from `/proc`. If the terminal is gone, a label remains or anything is ambiguous, **stop**: do not create another tab/Ceph or retry automatically. Also verify there are still no live native/owner-referenced children. A Pi may have SDK jobs not represented as native child terminals; the owner's confirmation is required too.

Build and send one properly quoted shell command, preserving the same terminal/tab. This starts **a new session**, not the old transcript or a fork:

```sh
LAUNCH=$(python3 - "$CWD" "$HANDOFF" "$NEW_ID" <<'PY'
import shlex, sys
cwd, note, sid = sys.argv[1:]
prompt = ('Read the attached handoff and current project rules, Tasks and inbox records. '
          'Confirm exact next step, pending replies and no unsettled children before continuing. '
          'Preserve the project role; do not infer new approvals from this note.')
print('cd -- ' + shlex.quote(cwd) + ' && ' + shlex.join(
    ['pi', '--session-id', sid, '--', '@' + note, prompt]))
PY
)
env -u HC_TERMINAL_ID -u HC_SCOPE -u HC_TERMINAL_SOCKET hc send "$TARGET" "$LAUNCH"
```

Run from an agent terminal, plain `hc send` wraps the text as an agent report (`<hc from=…>`) and the shell rejects it with a parse error, so drop the sender's `HC_*` variables as above (.pi task-717). Ctrl+D exits Pi only with an empty editor: if the prompt holds a draft, stop and ask whose it is; never clear it, and `hc keys … ctrl+u` does not clear a zsh line anyway.

Do not add model overrides; the real project keeps its existing role defaults. Verify once after the replacement's ordinary confirmation: same native address/root/tab, new `pi.session` header ID equals `NEW_ID`, new unique Pi PID/process group, old Pi gone, handoff acknowledged, pending inbox threads readable/repliable and next step correct. Queued inbox delivery follows the existing terminal/core address, not the old session ID. If delivery fails, stop and investigate rather than replaying messages blindly. Re-run the narrowed report and compare Pi plus descendant PSS; savings are observed, never promised. Never run two project Cephs or two copies of a session.

The disposable proof used an isolated core via `hc-test` on **every** call, including cleanup. It did not touch a live owner; see [actual evidence](../research/task-142.md). It established fresh process/session identity and queued-inbox continuity for both retained Bash and Zsh roots in the no-child case, including an attached handoff-file launch for Zsh. Same root terminal means an existing app tab need not be recreated; no app tab-selection command is part of this procedure. Other shell/wrapper lifecycles remain unproven and deferred.

**Risk:** lost pending replies, children killed by parent lifetime, duplicate ownership or a vanished tab. **Undo:** retain all new work and its new session path; at the replacement's confirmed idle prompt use `hc keys "$TARGET" ctrl+d`, verify its Pi PID exited while the same root remains, then send a shell-quoted `cd -- CWD && pi --session OLD_SESSION`. Verify the old session hint and handoff before continuing. Stop if any precondition fails. No transcript is removed.

## Finished manus or Worker: existing finish lifecycle

**Frees:** the captured child's process/tab and, for an isolated attempt, its worktree/branch. It may also integrate work. Quiet/native `done` is only a reason to inspect, never authorization to merge or discard.

The **starter** reads the real delivery. For a Worker use `worker_status` then `worker_handoff`; for a manus read the durable inbox delivery and actual checkout/Task. Verify the delivered HEAD, scope, runnable validations and human acceptance where required. The target-specific report names the starter and exact agent name.

```text
worker_status  {agent: "EXACT NAME"}          # Worker only
worker_handoff {agent: "EXACT NAME"}          # Worker only
worker_finish  {agent: "EXACT NAME"}          # verified ready delivery only
```

Discard is a different decision, not a low-memory substitute for finishing:

```text
worker_discard {agent: "EXACT NAME", note: "specific approved reason"}
```

Use the existing Worktrunk lifecycle; do not manually `hc kill`, remove a worktree or close a child pane. Finish receipts retry only incomplete steps. Read the receipt's actual integration range and `git revert` command. **Risk:** merging wrong work or discarding unaccepted work. **Undo:** revert the receipt's actual merge/range for a wrong integration; preserve unintegrated changes before any discard because discarded unbacked work has no promised undo. Only Algorant authorizes deletion with no backup.

## Browse-MCP processes: ownership before reclamation

**Frees:** only the measured selected browser/server process tree, not all browser RAM. Age, process name and an idle parent do not prove no active browser operation or session.

Use the finding's PID/owner to ask the owning Pi to confirm no operation is in flight and identify its MCP server lifecycle. Do not terminate a PID by name, age or `pkill`. There is no generic safe per-server close/restart primitive established here; the report gives a preparation/owner-check rather than a fabricated kill command. If a proven owner-controlled close exists, propose that exact action with a before/after and undo, get the required live-app approval, then run it through that owner. Otherwise leave it alone, or consider it as part of a separately proven owner rollover. **Risk:** breaking an operation or losing browser state. **Undo:** restart through its established owner/configuration; do not claim unsaved browser state is recoverable.

## Leftover isolated HC test cores

**Frees:** measured test core/holder/terminal processes only. A `/tmp` name is not sufficient to establish isolation. Never run bare `hc server stop`, source a historical env file or stop the real core to reclaim a few MiB.

The finding's root is an inspection candidate. First inspect the actual process's selected `HC_SESSION`, `HOME`, `XDG_RUNTIME_DIR`, `XDG_STATE_HOME` and `XDG_CONFIG_HOME` privately; confirm they match exactly what `~/.pi/agent/scripts/hc-test` sets for that root. Do not publish its full environment. A legacy test root using another socket/session layout is **not** a match: leave it running and ask its original owner. A dead root is not a live core to stop.

For a root positively verified as created by that helper, the approved owner may run these commands with the exact shell-quoted root from the finding:

```sh
HC_TEST_ROOT=/tmp/EXACT-ROOT ~/.pi/agent/scripts/hc-test server status
HC_TEST_ROOT=/tmp/EXACT-ROOT ~/.pi/agent/scripts/hc-test ls --json
# Only after the owner confirms every test terminal is disposable:
HC_TEST_ROOT=/tmp/EXACT-ROOT ~/.pi/agent/scripts/hc-test server stop
```

`hc-test` sets the scratch session, HOME and all XDG directories on **every** call and refuses roots outside `/tmp`. It also refuses a root that no longer exists: a core whose root (and socket) was deleted cannot be stopped this way and stays running; leave it and do not signal it (.pi task-716). Even the status call can create helper directories, so these commands are proposed actions, never part of this read-only report. A harness starts with `set -euo pipefail`. Check the original PID and scratch socket afterwards, then re-run the report; stopping a server does not prove every detached process exited. Preserve the root. **Risk:** ending active tests or using a nonmatching isolation layout. **Undo:** the original owner reruns its documented test command with the same helper; terminal state may not be recoverable. No scratch tree is deleted here.

## Stale `/tmp`: candidate is not permission to remove

**Frees:** allocated blocks on `/tmp` (RAM if tmpfs), not necessarily the sum of apparent file sizes. Hard links, sparse files, mount boundaries and racing writes limit estimates. Keep the report's per-root weight and observation limits visible.

The report identifies top-level roots for inspection only. Reuse the task-140 selection rules: all entries' **mtime and ctime** older than 24 hours; same current owner; readable entire tree; do not follow symlinks or cross mounts. Retain a whole root with any fresh descendant, socket/FIFO/device, HC/runtime/test tree, Pi child report, unverified session/history/JSONL, other owner, read error or named in-use exclusion. `/tmp/algos-mockups-*` remains explicitly excluded until its owner releases it.

After approval of an exact root list, a reviewed one-shot cleanup must:

1. Take two successful stderr-free `lsof -nP -Fpn` snapshots plus readable `/proc/*/cwd` links; protect every root in use. Unreadable process visibility means it cannot establish a safe delete set. Hidden privileged handles and new opens are still a stated limitation.
2. Preserve anything potentially useful with a verified backup before deletion; session/history retention uses the established session-store verifier, not a tarball as a substitute.
3. Refresh open-file/cwd protection immediately before mutation. Revalidate every candidate's tree membership, inode/type/owner/mtime/ctime/size against the reviewed snapshot. Stop on any change/error; no broad sweep.
4. Unlink only individually revalidated non-directories, without following symlinks; remove directories only when empty. No recursive `rm`, `find -delete`, wildcard or filesystem-wide age shortcut meets these rules.
5. Check every removed root is absent and every retained root still exists. Compare `statvfs` allocation before/after and report the exact observed delta.

The report is not that deletion script. Its per-root commands inspect the candidate; it intentionally emits no generic removal command that would bypass these protections. The task-140 cleanup was a point-in-time operation, not an installed maintenance utility. **Risk:** stale-looking files can still be useful/in use; races cannot be made globally atomic. **Undo:** restore only from a verified backup; no backup means no guaranteed undo and only Algorant can authorize removal.

## Cost and provenance

The report adds no idle/window read path, poller, timer, watcher, service, extension or retained runtime store. Its subprocesses finish before it returns; timing and child-launch count are printed for each run. Run evidence and the real desktop snapshot are recorded in [the delivery](../research/task-142.md).

This uses native HC metadata, existing Worker/Worktrunk receipts, the durable inbox and the existing scratch-core helper. It follows [the approved research](../research/task-140.md), which borrowed concise continuity notes and owner-supervised task lifecycle from Posthorse/Firstmate, deliberately not their background machinery. No fallback restart path or competing owner registry is added.
