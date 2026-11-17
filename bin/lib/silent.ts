// The one SILENT rule: a Pi that has been idle or done for at least SILENT_S while it still owes an
// item, and nothing is working under it. herdra-checkin judges an agent with it (herdra-check's
// `silent` flag) and bin/herdra-silent marks an In progress item with it ("(idle 58m)") for
// `herdra-open footer` and the Herdra window. Read-only data in, one answer out: no timer, nothing kept.

export const SILENT_S = 15 * 60;

export const machineOf = (address: string) => (address.includes("/") ? address.split("/")[0] : "");
export const idOf = (address: string) => address.split("/").pop() as string;

// A live terminal as `hc ls` lists it (the cheap index: no status time, `parent` possibly a bare id).
export interface Raw {
  address: string;
  agent?: string | null;
  name?: string | null;
  where?: string | null;
  parent?: string | null;
  status?: string | null;
}

// What the rule reads of one terminal: hc get's status time with hc ls's address, space and tab.
export interface Term {
  address: string; machine: string; id: string; agent: string;
  where: string; space: string; tab: string; status: string | null; statusAt: number; parent: string | null;
}

// A terminal's parent as an address, and the space it is in, from its `hc ls` entry.
export const rawParent = (t: Raw): string | null =>
  t.parent ? (t.parent.includes("/") || !machineOf(t.address) ? t.parent : `${machineOf(t.address)}/${t.parent}`) : null;
export const rawSpace = (t: Raw): string => String(t.where ?? "").split(" / ")[0];

// The live terminals an item's `on` names, the same resolution `herdra-open list` uses: an hc name or
// address (a machine-qualified one, `homelab-server/t1`, on that machine; whois reads one the same way),
// `name@machine` for another machine, or a project, whose Ceph is the Pi in its space's main tab on any
// machine.
export const owners = (on: string, live: Raw[]): Raw[] => {
  const [name = "", at] = String(on ?? "").split("@");
  const wanted = at === undefined ? name : `${at}/${name}`;
  return live.filter((t) => {
    const sameMachine = machineOf(t.address) === (at ?? "");
    const named = t.address === wanted || (sameMachine && (idOf(t.address) === name || t.name === name));
    const ceph = (at === undefined || sameMachine) && t.agent === "pi" && rawSpace(t).toLowerCase() === name.toLowerCase()
      && String(t.where ?? "").split(" / ")[1] === "main";
    return named || ceph;
  });
};

// A Pi that is working while it has a working child (or, for a Ceph, another working Pi in its space)
// is waiting on that work, not silent.
export const waitsOnWork = (t: Pick<Term, "address" | "machine" | "tab" | "agent" | "space">, live: Raw[]): boolean =>
  live.some((x) => x.address !== t.address && x.status === "working"
    && (rawParent(x) === t.address
      || (t.tab === "main" && t.agent === "pi" && x.agent === "pi" && machineOf(x.address) === t.machine && rawSpace(x) === t.space)));

// The rule itself. `owedSince` is when the oldest thing it owes started (seconds), `now` seconds:
// SILENT when it is idle or done, that status and the debt are both at least SILENT_S old, and nothing
// works under it. Returns how long it has been in that status (the age the mark prints), else undefined.
export const silentAge = (
  t: Pick<Term, "address" | "machine" | "tab" | "agent" | "space" | "status" | "statusAt">,
  owedSince: number,
  live: Raw[],
  now: number,
): number | undefined => {
  if (!((t.status === "idle" || t.status === "done") && t.statusAt)) return undefined;
  if (waitsOnWork(t, live)) return undefined;
  if (now - Math.max(t.statusAt, owedSince) < SILENT_S) return undefined;
  return now - t.statusAt;
};

// A duration the way a card and the footer write it: 42s, 58m, 3h37m, 2d4h.
export const dur = (s: number) => {
  s = Math.max(0, Math.round(s));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}m`;
  return `${Math.floor(s / 86400)}d${Math.floor((s % 86400) / 3600)}h`;
};
