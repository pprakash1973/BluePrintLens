import { childrenOf, descendantIds, type Link, type ProcessModel, type Step } from "./model";
import type { Focus } from "@/components/FlowCanvas";

/** Everything upstream and downstream of a step (follows links in both directions, each direction separately). */
export function focusOf(stepId: string, links: Link[]): Focus {
  const nodes = new Set([stepId]);
  const edges = new Set<string>();
  for (const dir of ["down", "up"] as const) {
    const q = [stepId];
    const seen = new Set([stepId]);
    while (q.length) {
      const cur = q.shift()!;
      for (const l of links) {
        const [a, b] = dir === "down" ? [l.from, l.to] : [l.to, l.from];
        if (a !== cur) continue;
        edges.add(l.id);
        nodes.add(b);
        if (!seen.has(b)) { seen.add(b); q.push(b); }
      }
    }
  }
  return { nodes, edges };
}

/** Shortest path (by number of links) between two steps, or null if unreachable. */
export function shortestPath(from: string, to: string, links: Link[]): Focus | null {
  const prev = new Map<string, Link>();
  const q = [from];
  const seen = new Set([from]);
  while (q.length) {
    const cur = q.shift()!;
    if (cur === to) break;
    for (const l of links) {
      if (l.from !== cur || seen.has(l.to)) continue;
      seen.add(l.to); prev.set(l.to, l); q.push(l.to);
    }
  }
  if (!seen.has(to)) return null;
  const nodes = new Set([to]);
  const edges = new Set<string>();
  for (let cur = to; cur !== from;) {
    const l = prev.get(cur)!;
    edges.add(l.id); nodes.add(l.from); cur = l.from;
  }
  return { nodes, edges };
}

/** Collapse each direct child process of `scopeId` into one node unless it is in `expanded`. */
export function groupSteps(m: ProcessModel, scopeId: string, expanded: Set<string>): { steps: Step[]; links: Link[]; groups: number } {
  const kids = childrenOf(m, scopeId).filter((c) => m.steps.some((s) => descendantIds(m, c.id).has(s.processId)));
  const scopeIds = descendantIds(m, scopeId);
  const owner = new Map<string, string>(); // stepId -> kid id
  for (const c of kids) {
    const ids = descendantIds(m, c.id);
    for (const s of m.steps) if (ids.has(s.processId)) owner.set(s.id, c.id);
  }
  const steps: Step[] = [];
  const mapTo = new Map<string, string>();
  for (const s of m.steps.filter((x) => scopeIds.has(x.processId))) {
    const k = owner.get(s.id);
    if (!k || expanded.has(k)) { steps.push(s); mapTo.set(s.id, s.id); }
  }
  const emitted = new Set<string>();
  for (const c of kids) {
    if (expanded.has(c.id)) continue;
    const inner = m.steps.filter((s) => owner.get(s.id) === c.id);
    if (!inner.length) continue;
    const gid = `grp:${c.id}`;
    inner.forEach((s) => mapTo.set(s.id, gid));
    const freq = new Map<string, number>();
    inner.forEach((s) => s.roles.forEach((r) => freq.set(r.role, (freq.get(r.role) ?? 0) + 1)));
    const top = [...freq.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    const auto = inner.find((s) => s.automationTag !== "none");
    steps.push({
      id: gid, processId: c.id, name: `${c.name} (${inner.length})`, type: "subprocess", description: `${inner.length} steps. ${c.objective}`.trim(),
      roles: top ? [{ role: top, raci: "R" }] : [], systems: [...new Set(inner.flatMap((s) => s.systems))].slice(0, 3), inputs: [], outputs: [], rules: [], sla: "",
      controls: inner.flatMap((s) => s.controls), painPoints: inner.flatMap((s) => s.painPoints), automationTag: auto?.automationTag ?? "none",
      automationRationale: "", confidence: Math.min(...inner.map((s) => s.confidence)), sourceRef: "",
    });
    emitted.add(gid);
  }
  const seen = new Set<string>();
  const links: Link[] = [];
  for (const l of m.links) {
    const a = mapTo.get(l.from), b = mapTo.get(l.to);
    if (!a || !b || a === b) continue;
    const key = `${a}>${b}`;
    if (seen.has(key)) continue;
    seen.add(key);
    links.push(a === l.from && b === l.to ? l : { ...l, id: `g_${l.id}`, from: a, to: b });
  }
  return { steps, links, groups: emitted.size };
}
