import type { Link, Step } from "./model";

/** Header column width for swimlane labels. */
export const LANE_LABEL_W = 170;
const COL_GAP = 64;
const ROW_GAP = 26;
const LANE_PAD = 26;
const LEFT_PAD = 28;

export const SIZE = {
  task: { w: 196, h: 72 },
  subprocess: { w: 196, h: 72 },
  decision: { w: 156, h: 88 },
  event: { w: 44, h: 44 },
} as const;
// legacy exports used by other components
export const NODE_W = SIZE.task.w;
export const NODE_H = SIZE.task.h;

export type LaneBy = "role" | "system";
export type NodeKind = "task" | "decision" | "subprocess" | "event" | "start" | "end";
export type Placed = { id: string; step: Step | null; kind: NodeKind; x: number; y: number; w: number; h: number; lane: string; layer: number };
export type LaneBox = { name: string; y: number; h: number };
export type Side = "l" | "r" | "t" | "b";
export type LayoutLink = Link & { implied?: boolean; back?: boolean; sourceSide: Side; targetSide: Side };
export type Layout = { nodes: Placed[]; lanes: LaneBox[]; width: number; height: number; links: LayoutLink[]; order: Step[] };

export function laneOf(s: Step, by: LaneBy): string {
  if (by === "role") {
    const r = s.roles.find((x) => x.raci === "R") ?? s.roles.find((x) => x.raci === "A") ?? s.roles[0];
    return r?.role ?? "Unassigned";
  }
  return s.systems[0] ?? "No system";
}

const kindOf = (s: Step): NodeKind => (s.type === "decision" ? "decision" : s.type === "event" ? "event" : s.type === "subprocess" ? "subprocess" : "task");
const sizeOf = (k: NodeKind) => (k === "start" || k === "end" || k === "event" ? SIZE.event : SIZE[k]);

/**
 * Layered swimlane layout (Sugiyama-style):
 * 1. chain unconnected steps in document order (implied links) and add start/end events,
 * 2. break cycles, assign layers by longest path,
 * 3. order nodes inside each lane/column by barycenter to reduce crossings,
 * 4. place columns with per-column widths so every lane shares the same time axis,
 * 5. pick connection sides so edges route orthogonally (forward: right→left, loops: under the nodes).
 */
export function layoutSteps(steps: Step[], allLinks: Link[], by: LaneBy): Layout {
  const ids = new Set(steps.map((s) => s.id));
  const real = allLinks.filter((l) => ids.has(l.from) && ids.has(l.to) && l.from !== l.to);
  const hasIn = new Set(real.map((l) => l.to));
  const hasOut = new Set(real.map((l) => l.from));

  // 1a. implied links: consecutive steps of the same process where the chain is otherwise broken
  const implied: Link[] = [];
  const byProc = new Map<string, Step[]>();
  steps.forEach((s) => { if (!byProc.has(s.processId)) byProc.set(s.processId, []); byProc.get(s.processId)!.push(s); });
  for (const list of byProc.values()) {
    for (let i = 0; i + 1 < list.length; i++) {
      const a = list[i], b = list[i + 1];
      if (!hasOut.has(a.id) && !hasIn.has(b.id)) {
        implied.push({ id: `imp_${a.id}_${b.id}`, from: a.id, to: b.id, type: "sequence", condition: "" });
        hasOut.add(a.id); hasIn.add(b.id);
      }
    }
  }
  const links: LayoutLink[] = [...real, ...implied].map((l) => ({ ...l, implied: l.id.startsWith("imp_"), sourceSide: "r", targetSide: "l" }));

  // nodes
  const nodes = new Map<string, Placed>();
  for (const s of steps) {
    const kind = kindOf(s);
    const sz = sizeOf(kind);
    nodes.set(s.id, { id: s.id, step: s, kind, x: 0, y: 0, w: sz.w, h: sz.h, lane: laneOf(s, by), layer: 0 });
  }
  // 1b. start / end events
  if (steps.length) {
    const sources = steps.filter((s) => !hasIn.has(s.id));
    const sinks = steps.filter((s) => !hasOut.has(s.id));
    const startTargets = sources.length ? sources : [steps[0]];
    nodes.set("__start", { id: "__start", step: null, kind: "start", x: 0, y: 0, ...SIZE.event, lane: laneOf(startTargets[0], by), layer: 0 });
    startTargets.forEach((s, i) => links.push({ id: `st_${i}_${s.id}`, from: "__start", to: s.id, type: "sequence", condition: "", sourceSide: "r", targetSide: "l" }));
    if (sinks.length) {
      nodes.set("__end", { id: "__end", step: null, kind: "end", x: 0, y: 0, ...SIZE.event, lane: laneOf(sinks[sinks.length - 1], by), layer: 0 });
      sinks.forEach((s, i) => links.push({ id: `en_${i}_${s.id}`, from: s.id, to: "__end", type: "sequence", condition: "", sourceSide: "r", targetSide: "l" }));
    }
  }

  // 2. cycle breaking (DFS from start) + longest-path layering
  const out = new Map<string, LayoutLink[]>();
  nodes.forEach((_, id) => out.set(id, []));
  links.forEach((l) => out.get(l.from)!.push(l));
  const state = new Map<string, number>();
  const visit = (u: string) => {
    state.set(u, 1);
    for (const l of out.get(u)!) {
      if (state.get(l.to) === 1) l.back = true;
      else if (!state.get(l.to)) visit(l.to);
    }
    state.set(u, 2);
  };
  ["__start", ...nodes.keys()].forEach((id) => { if (nodes.has(id) && !state.get(id)) visit(id); });
  const dag = links.filter((l) => !l.back);
  const layer = new Map<string, number>([...nodes.keys()].map((k) => [k, 0]));
  for (let i = 0; i <= nodes.size; i++) {
    let changed = false;
    for (const l of dag) {
      const nv = layer.get(l.from)! + 1;
      if (nv > layer.get(l.to)!) { layer.set(l.to, nv); changed = true; }
    }
    if (!changed) break;
  }
  // pull the end event to the last column
  const maxLayer = Math.max(0, ...layer.values());
  if (nodes.has("__end")) layer.set("__end", maxLayer);
  nodes.forEach((n, id) => (n.layer = layer.get(id)!));

  // lanes ordered by where they first appear on the time axis
  const laneFirst = new Map<string, number>();
  [...nodes.values()].sort((a, b) => a.layer - b.layer).forEach((n) => { if (!laneFirst.has(n.lane)) laneFirst.set(n.lane, n.layer); });
  const laneNames = [...laneFirst.keys()];
  const laneIdx = new Map(laneNames.map((n, i) => [n, i]));

  // 3. order inside each (lane, layer) cell by barycenter of predecessors
  const cells = new Map<string, Placed[]>();
  nodes.forEach((n) => { const k = `${n.lane}|${n.layer}`; if (!cells.has(k)) cells.set(k, []); cells.get(k)!.push(n); });
  const preds = new Map<string, string[]>();
  dag.forEach((l) => { if (!preds.has(l.to)) preds.set(l.to, []); preds.get(l.to)!.push(l.from); });
  const slot = new Map<string, number>();
  cells.forEach((list) => list.forEach((n, i) => slot.set(n.id, i)));
  const rank = (id: string) => laneIdx.get(nodes.get(id)!.lane)! * 100 + (slot.get(id) ?? 0);
  for (let sweep = 0; sweep < 3; sweep++) {
    for (let L = 0; L <= maxLayer; L++) {
      cells.forEach((list) => {
        if (list[0].layer !== L || list.length < 2) return;
        const key = (n: Placed) => { const p = preds.get(n.id) ?? []; return p.length ? p.reduce((a, b) => a + rank(b), 0) / p.length : rank(n.id); };
        list.sort((a, b) => key(a) - key(b));
        list.forEach((n, i) => slot.set(n.id, i));
      });
    }
  }

  // 4. geometry
  const colW = Array.from({ length: maxLayer + 1 }, () => 0);
  nodes.forEach((n) => (colW[n.layer] = Math.max(colW[n.layer], n.w)));
  const colX: number[] = [];
  let x = LANE_LABEL_W + LEFT_PAD;
  colW.forEach((w, i) => { colX[i] = x; x += w + COL_GAP; });
  const width = x - COL_GAP + LEFT_PAD;

  const ROW_H = SIZE.decision.h;
  const stackOf = new Map<string, number>();
  cells.forEach((list) => stackOf.set(list[0].lane, Math.max(stackOf.get(list[0].lane) ?? 1, list.length)));
  const lanes: LaneBox[] = [];
  let y = 0;
  for (const name of laneNames) {
    const h = (stackOf.get(name) ?? 1) * (ROW_H + ROW_GAP) - ROW_GAP + LANE_PAD * 2;
    lanes.push({ name, y, h });
    y += h;
  }
  const laneBox = new Map(lanes.map((l) => [l.name, l]));
  nodes.forEach((n) => {
    const lb = laneBox.get(n.lane)!;
    n.x = colX[n.layer] + (colW[n.layer] - n.w) / 2;
    n.y = lb.y + LANE_PAD + (slot.get(n.id) ?? 0) * (ROW_H + ROW_GAP) + (ROW_H - n.h) / 2;
  });

  // 5. connection sides
  for (const l of links) {
    const a = nodes.get(l.from)!, b = nodes.get(l.to)!;
    if (l.back) { l.sourceSide = "b"; l.targetSide = "b"; }
    else if (a.layer === b.layer) { const down = b.y > a.y; l.sourceSide = down ? "b" : "t"; l.targetSide = down ? "t" : "b"; }
    else { l.sourceSide = "r"; l.targetSide = "l"; }
  }

  const placed = [...nodes.values()];
  const order = placed.filter((n) => n.step).sort((a, b) => a.layer - b.layer || laneIdx.get(a.lane)! - laneIdx.get(b.lane)! || (slot.get(a.id)! - slot.get(b.id)!)).map((n) => n.step!);
  return { nodes: placed, lanes, width, height: y, links, order };
}
