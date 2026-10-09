import type { Link, Step } from "./model";

export const NODE_W = 180;
export const NODE_H = 64;
export const COL_GAP = 70;
export const LANE_PAD = 24;
export const LANE_LABEL_W = 150;

export type LaneBy = "role" | "system";
export type Placed = { step: Step; x: number; y: number; lane: string; layer: number };
export type LaneBox = { name: string; y: number; h: number };
export type Layout = { nodes: Placed[]; lanes: LaneBox[]; width: number; height: number; links: Link[]; order: Step[] };

export function laneOf(s: Step, by: LaneBy): string {
  if (by === "role") {
    const r = s.roles.find((x) => x.raci === "R") ?? s.roles.find((x) => x.raci === "A") ?? s.roles[0];
    return r?.role ?? "Unassigned";
  }
  return s.systems[0] ?? "No system";
}

/** Swimlane layout: layers by longest path (back-edges ignored), lanes by role or system. */
export function layoutSteps(steps: Step[], allLinks: Link[], by: LaneBy): Layout {
  const ids = new Set(steps.map((s) => s.id));
  const links = allLinks.filter((l) => ids.has(l.from) && ids.has(l.to));
  const out = new Map<string, string[]>();
  const indeg = new Map<string, number>();
  steps.forEach((s) => { out.set(s.id, []); indeg.set(s.id, 0); });
  links.forEach((l) => { out.get(l.from)!.push(l.to); indeg.set(l.to, (indeg.get(l.to) ?? 0) + 1); });

  // DFS to find back edges
  const state = new Map<string, number>();
  const back = new Set<string>();
  const dfs = (u: string) => {
    state.set(u, 1);
    for (const v of out.get(u)!) {
      if (state.get(v) === 1) back.add(`${u}>${v}`);
      else if (!state.get(v)) dfs(v);
    }
    state.set(u, 2);
  };
  const roots = steps.filter((s) => !indeg.get(s.id)).map((s) => s.id);
  [...roots, ...steps.map((s) => s.id)].forEach((id) => { if (!state.get(id)) dfs(id); });

  const dag = links.filter((l) => !back.has(`${l.from}>${l.to}`));
  const layer = new Map<string, number>();
  steps.forEach((s) => layer.set(s.id, 0));
  // relax repeatedly (DAG, so converges in <= n passes)
  for (let i = 0; i < steps.length; i++) {
    let changed = false;
    for (const l of dag) {
      const nv = (layer.get(l.from) ?? 0) + 1;
      if (nv > (layer.get(l.to) ?? 0)) { layer.set(l.to, nv); changed = true; }
    }
    if (!changed) break;
  }

  const laneNames: string[] = [];
  const laneOfStep = new Map<string, string>();
  steps.forEach((s) => {
    const ln = laneOf(s, by);
    laneOfStep.set(s.id, ln);
    if (!laneNames.includes(ln)) laneNames.push(ln);
  });

  // stack count per (lane, layer)
  const cell = new Map<string, number>();
  const maxStack = new Map<string, number>();
  const slot = new Map<string, number>();
  steps.forEach((s) => {
    const k = `${laneOfStep.get(s.id)}|${layer.get(s.id)}`;
    const n = cell.get(k) ?? 0;
    cell.set(k, n + 1);
    slot.set(s.id, n);
    const ln = laneOfStep.get(s.id)!;
    maxStack.set(ln, Math.max(maxStack.get(ln) ?? 1, n + 1));
  });

  const lanes: LaneBox[] = [];
  let y = 0;
  for (const name of laneNames) {
    const h = (maxStack.get(name) ?? 1) * (NODE_H + 20) + LANE_PAD * 2 - 20;
    lanes.push({ name, y, h });
    y += h;
  }
  const maxLayer = Math.max(0, ...steps.map((s) => layer.get(s.id) ?? 0));
  const nodes: Placed[] = steps.map((s) => {
    const ln = laneOfStep.get(s.id)!;
    const lane = lanes.find((l) => l.name === ln)!;
    return {
      step: s, lane: ln, layer: layer.get(s.id) ?? 0,
      x: LANE_LABEL_W + 30 + (layer.get(s.id) ?? 0) * (NODE_W + COL_GAP),
      y: lane.y + LANE_PAD + (slot.get(s.id) ?? 0) * (NODE_H + 20),
    };
  });
  const order = [...steps].sort((a, b) => (layer.get(a.id)! - layer.get(b.id)!) || (laneNames.indexOf(laneOfStep.get(a.id)!) - laneNames.indexOf(laneOfStep.get(b.id)!)));
  return { nodes, lanes, width: LANE_LABEL_W + 60 + (maxLayer + 1) * (NODE_W + COL_GAP), height: y, links, order };
}
