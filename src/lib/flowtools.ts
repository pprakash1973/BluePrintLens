import { childrenOf, descendantIds, type Link, type ProcessModel, type Step } from "./model";
import type { Focus } from "@/components/FlowCanvas";
import { withImplied } from "./layout";

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
    links.push(a === l.from && b === l.to ? l : { ...l, id: `g_${l.id}`, from: a, to: b, condition: "", type: l.type === "handoff" ? "handoff" : "sequence" });
  }
  return { steps, links, groups: emitted.size };
}

const POSITIVE = /^(yes|y|approved?|valid|ok|pass(ed)?|true|in stock|available|within|matched|fully matched|received|complete|released|accepted|no dispute)\b/i;
const NEG_QUESTION = /\b(dispute|duplicate|exception|error|issue|problem|discrepan\w*|reject\w*|missing|fail\w*|hold|blocked|overdue|mismatch\w*|short|damaged|return\w*)\b/i;
const NEGATIVE = /^(no|n|rejected?|invalid|fail(ed)?|exception|hold|missing|dispute|duplicate|not|over|short|unmatched|partial)\b/i;

/**
 * The "happy path": from each entry step, follow the most likely next step —
 * never exception links, prefer positive decision branches, then the branch that leads furthest.
 */
export function mainPath(steps: Step[], links: Link[]): Focus {
  const { links: all } = withImplied(steps, links);
  const out = new Map<string, Link[]>();
  steps.forEach((s) => out.set(s.id, []));
  all.forEach((l) => out.get(l.from)?.push(l));
  // remaining-length estimate over a DAG (back edges ignored)
  const depth = new Map<string, number>();
  const onStack = new Set<string>();
  const far = (u: string): number => {
    if (depth.has(u)) return depth.get(u)!;
    if (onStack.has(u)) return 0;
    onStack.add(u);
    let best = 0;
    for (const l of out.get(u) ?? []) if (l.type !== "exception") best = Math.max(best, 1 + far(l.to));
    onStack.delete(u);
    depth.set(u, best);
    return best;
  };
  const nameOf = new Map(steps.map((x) => [x.id, x.name]));
  // "Dispute raised?", "Duplicate order?": the happy path is the "No" branch
  const negQuestion = (id: string) => NEG_QUESTION.test(nameOf.get(id) ?? "");
  const score = (l: Link) => {
    const c = l.condition.trim();
    const polarity = (POSITIVE.test(c) ? 10 : 0) + (NEGATIVE.test(c) ? -10 : 0);
    return (l.type === "exception" ? -100 : 0) + (negQuestion(l.from) ? -polarity : polarity) + far(l.to) / 100;
  };

  const nodes = new Set<string>();
  const edges = new Set<string>();
  const hasIn = new Set(all.map((l) => l.to));
  const sources = steps.filter((s) => !hasIn.has(s.id));
  for (const src of sources.length ? sources : steps.slice(0, 1)) {
    let cur: string | undefined = src.id;
    while (cur && !nodes.has(cur)) {
      nodes.add(cur);
      const opts = (out.get(cur) ?? []).filter((l) => l.type !== "exception").sort((a, b) => score(b) - score(a));
      const next: Link | undefined = opts.find((l) => !nodes.has(l.to)) ?? undefined;
      if (!next) break;
      edges.add(next.id);
      cur = next.to;
    }
  }
  return { nodes, edges };
}

const MANUAL = /\b(excel|spreadsheets?|e-?mail|phone|paper|manual(ly)?|re-?key(ed|ing)?|scanned|print(ed)?|shared tracker|offline)\b/i;
/** Heuristic: the step relies on manual tools or rework rather than a system of record. */
export function isManual(s: Step): boolean {
  return s.systems.some((x) => MANUAL.test(x)) || MANUAL.test(`${s.name} ${s.description} ${s.painPoints.join(" ")}`);
}
