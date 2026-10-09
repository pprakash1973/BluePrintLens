"use client";
import { useEffect, useMemo } from "react";
import {
  ReactFlow, ReactFlowProvider, Background, Controls, MiniMap, Handle, Position, useReactFlow, MarkerType,
  type Node, type Edge, type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Flame, ShieldCheck, Cog, AlertTriangle, GitBranch, Check, MessageSquare } from "lucide-react";
import type { Link, Step } from "@/lib/model";
import { LOW_CONFIDENCE } from "@/lib/model";
import { layoutSteps, NODE_H, NODE_W, LANE_LABEL_W, type LaneBy } from "@/lib/layout";

export type Overlays = { pain: boolean; controls: boolean; automation: boolean; confidence: boolean };
export type StepBadge = { approved: number; changes: number; comments: number };

type StepData = {
  step: Step; dim: boolean; selected: boolean; active: boolean; overlays: Overlays; badge?: StepBadge; diff?: "added" | "changed";
};

function StepNode({ data }: NodeProps<Node<StepData>>) {
  const { step: s, dim, selected, active, overlays, badge, diff } = data;
  const ring =
    active ? "ring-4 ring-brand/60" : selected ? "ring-2 ring-brand" : overlays.pain && s.painPoints.length ? "ring-2 ring-pain/70"
    : overlays.controls && s.controls.length ? "ring-2 ring-control/70" : overlays.automation && s.automationTag !== "none" ? "ring-2 ring-auto/70"
    : overlays.confidence && s.confidence < LOW_CONFIDENCE ? "ring-2 ring-warn/80" : "";
  const accent = s.type === "decision" ? "border-l-warn" : s.type === "event" ? "border-l-control" : s.type === "subprocess" ? "border-l-auto" : "border-l-brand";
  return (
    <div
      className={`flex flex-col justify-between rounded-lg border border-line border-l-4 bg-white px-2 py-1.5 text-left shadow-sm transition ${accent} ${ring} ${dim ? "opacity-25" : ""} ${diff === "added" ? "bg-green-50" : diff === "changed" ? "bg-amber-50" : ""}`}
      style={{ width: NODE_W, height: NODE_H }}
      role="button" aria-label={`${s.type}: ${s.name}`}
    >
      <Handle type="target" position={Position.Left} className="!h-1.5 !w-1.5 !bg-slate-400" />
      <div className="flex items-start gap-1 text-xs font-semibold leading-tight text-ink">
        {s.type === "decision" && <GitBranch size={12} className="mt-0.5 shrink-0 text-warn" aria-hidden />}
        <span className="line-clamp-2">{s.name}</span>
      </div>
      <div className="flex items-center gap-1.5 text-[10px] text-muted">
        {s.painPoints.length > 0 && <span title="Pain points" className="flex items-center gap-0.5 text-pain"><Flame size={11} />{s.painPoints.length}</span>}
        {s.controls.length > 0 && <span title="Controls" className="flex items-center gap-0.5 text-control"><ShieldCheck size={11} />{s.controls.length}</span>}
        {s.automationTag !== "none" && <span title={`Automation: ${s.automationTag}`} className="flex items-center gap-0.5 text-auto"><Cog size={11} />{s.automationTag}</span>}
        {s.confidence < LOW_CONFIDENCE && <span title={`Low confidence ${Math.round(s.confidence * 100)}%`} className="text-warn"><AlertTriangle size={11} /></span>}
        {badge && badge.approved > 0 && <span title="Approved" className="flex items-center text-control"><Check size={11} />{badge.approved}</span>}
        {badge && badge.comments > 0 && <span title="Comments" className="flex items-center gap-0.5"><MessageSquare size={11} />{badge.comments}</span>}
      </div>
      <Handle type="source" position={Position.Right} className="!h-1.5 !w-1.5 !bg-slate-400" />
    </div>
  );
}

function LaneNode({ data }: NodeProps<Node<{ name: string; w: number; h: number; odd: boolean }>>) {
  return (
    <div style={{ width: data.w, height: data.h }} className={`flex border-y border-line ${data.odd ? "bg-slate-50" : "bg-white"}`}>
      <div style={{ width: LANE_LABEL_W }} className="flex items-center border-r border-line bg-slate-100 px-3 text-xs font-semibold text-ink">{data.name}</div>
    </div>
  );
}

const nodeTypes = { step: StepNode, lane: LaneNode };

const EDGE_COLOR: Record<Link["type"], string> = { sequence: "#64748b", conditional: "#d98a00", handoff: "#2f6fed", exception: "#d93b3b" };

function Focus({ id, nodes }: { id?: string | null; nodes: Node[] }) {
  const rf = useReactFlow();
  useEffect(() => {
    if (!id) return;
    const n = nodes.find((x) => x.id === id);
    if (n) rf.setCenter(n.position.x + NODE_W / 2, n.position.y + NODE_H / 2, { zoom: 1, duration: 450 });
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

export type FlowProps = {
  steps: Step[]; links: Link[]; by: LaneBy; matches: Set<string> | null; selectedId?: string | null; activeId?: string | null;
  overlays: Overlays; badges?: Record<string, StepBadge>; diff?: Record<string, "added" | "changed">; onSelect: (id: string | null) => void;
};

function Inner(p: FlowProps) {
  const layout = useMemo(() => layoutSteps(p.steps, p.links, p.by), [p.steps, p.links, p.by]);
  const nodes: Node[] = useMemo(() => {
    const lanes: Node[] = layout.lanes.map((l, i) => ({
      id: `lane-${l.name}`, type: "lane", position: { x: 0, y: l.y }, data: { name: l.name, w: layout.width, h: l.h, odd: i % 2 === 1 },
      draggable: false, selectable: false, zIndex: -1, focusable: false,
    }));
    const steps: Node[] = layout.nodes.map((n) => ({
      id: n.step.id, type: "step", position: { x: n.x, y: n.y }, draggable: false,
      data: {
        step: n.step, dim: !!p.matches && !p.matches.has(n.step.id), selected: p.selectedId === n.step.id, active: p.activeId === n.step.id,
        overlays: p.overlays, badge: p.badges?.[n.step.id], diff: p.diff?.[n.step.id],
      } satisfies StepData,
    }));
    return [...lanes, ...steps];
  }, [layout, p.matches, p.selectedId, p.activeId, p.overlays, p.badges, p.diff]);

  const edges: Edge[] = useMemo(() => layout.links.map((l) => ({
    id: l.id, source: l.from, target: l.to, label: l.condition || undefined, type: "smoothstep",
    style: { stroke: EDGE_COLOR[l.type], strokeWidth: 1.6, strokeDasharray: l.type === "exception" ? "5 4" : undefined },
    labelStyle: { fontSize: 10, fill: "#334155" }, labelBgStyle: { fill: "#fff" },
    markerEnd: { type: MarkerType.ArrowClosed, color: EDGE_COLOR[l.type] },
  })), [layout]);

  return (
    <ReactFlow
      key={`${p.by}-${layout.nodes.length}-${layout.lanes.length}`}
      nodes={nodes} edges={edges} nodeTypes={nodeTypes} fitView fitViewOptions={{ padding: 0.1 }} minZoom={0.15}
      nodesDraggable={false} nodesConnectable={false} elementsSelectable
      onNodeClick={(_, n) => { if (n.type === "step") p.onSelect(n.id); }}
      onPaneClick={() => p.onSelect(null)} proOptions={{ hideAttribution: true }}
    >
      <Background gap={24} color="#eef0f6" />
      <Controls showInteractive={false} />
      {layout.nodes.length > 40 && <MiniMap pannable zoomable />}
      <Focus id={p.activeId} nodes={nodes} />
    </ReactFlow>
  );
}

export function FlowCanvas(p: FlowProps) {
  if (!p.steps.length) return <div className="grid h-full place-items-center text-sm text-muted">No steps in this scope.</div>;
  return <ReactFlowProvider><Inner {...p} /></ReactFlowProvider>;
}
