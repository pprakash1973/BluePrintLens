"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ReactFlow, ReactFlowProvider, Background, BackgroundVariant, Controls, MiniMap, Handle, Position, Panel, useReactFlow, useViewport, MarkerType,
  type Node, type Edge, type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Flame, ShieldCheck, Cog, AlertTriangle, Check, MessageSquare, Plus, Info, Hand, Repeat, Clock, Users } from "lucide-react";
import { isManual } from "@/lib/flowtools";
import { fmtHrs, type EvidenceStats } from "@/lib/evidence";
import type { Link, Step } from "@/lib/model";
import { LOW_CONFIDENCE } from "@/lib/model";
import { layoutSteps, LANE_LABEL_W, laneOf, type LaneBy, type NodeKind, type Placed, type Side } from "@/lib/layout";

export type Overlays = { pain: boolean; controls: boolean; automation: boolean; confidence: boolean; handoffs: boolean };
export type Focus = { nodes: Set<string>; edges: Set<string> };
export type StepBadge = { approved: number; changes: number; comments: number };

type EvNode = { cases: number; wait: number; rework: number; heat: number; observed: boolean };
type StepData = {
  step: Step | null; kind: NodeKind; w: number; h: number; dim: boolean; selected: boolean; active: boolean;
  overlays: Overlays; badge?: StepBadge; diff?: "added" | "changed";
  detailed?: boolean; secondary?: boolean; hiddenAlt?: number; ev?: EvNode;
};

const SIDE_POS: Record<Side, Position> = { l: Position.Left, r: Position.Right, t: Position.Top, b: Position.Bottom };
const hidden = "!h-2 !w-2 !min-w-0 !border-0 !bg-transparent";

/** One source + one target handle per side so the layout can choose orthogonal connection points. */
function Handles() {
  return (
    <>
      {(["l", "r", "t", "b"] as Side[]).map((s) => (
        <span key={s}>
          <Handle id={`s-${s}`} type="source" position={SIDE_POS[s]} className={hidden} isConnectable={false} />
          <Handle id={`t-${s}`} type="target" position={SIDE_POS[s]} className={hidden} isConnectable={false} />
        </span>
      ))}
    </>
  );
}

function ring(d: StepData) {
  const s = d.step!;
  if (d.active) return "ring-4 ring-brand/60";
  if (d.selected) return "ring-2 ring-brand ring-offset-2";
  if (d.overlays.pain && s.painPoints.length) return "ring-2 ring-pain/80";
  if (d.overlays.controls && s.controls.length) return "ring-2 ring-control/80";
  if (d.overlays.automation && s.automationTag !== "none") return "ring-2 ring-auto/80";
  if (d.overlays.confidence && s.confidence < LOW_CONFIDENCE) return "ring-2 ring-warn/90";
  return "";
}

function Badges({ s, badge }: { s: Step; badge?: StepBadge }) {
  return (
    <div className="flex items-center gap-1.5 text-[10px] text-muted">
      {isManual(s) && <span title="Manual workaround / off-system work (detected)" className="flex items-center gap-0.5 text-[#b45309]"><Hand size={11} />manual</span>}
      {s.painPoints.length > 0 && <span title="Pain points" className="flex items-center gap-0.5 text-pain"><Flame size={11} />{s.painPoints.length}</span>}
      {s.controls.length > 0 && <span title="Controls" className="flex items-center gap-0.5 text-control"><ShieldCheck size={11} />{s.controls.length}</span>}
      {s.automationTag !== "none" && <span title={`Automation: ${s.automationTag}`} className="flex items-center gap-0.5 text-auto"><Cog size={11} />{s.automationTag}</span>}
      {s.confidence < LOW_CONFIDENCE && <span title={`Low confidence ${Math.round(s.confidence * 100)}%`} className="text-warn"><AlertTriangle size={11} /></span>}
      {badge && badge.approved > 0 && <span title="Approved" className="flex items-center text-control"><Check size={11} />{badge.approved}</span>}
      {badge && badge.comments > 0 && <span title="Comments" className="flex items-center gap-0.5"><MessageSquare size={11} />{badge.comments}</span>}
    </div>
  );
}

function Tooltip({ s }: { s: Step }) {
  return (
    <div className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 hidden w-64 -translate-x-1/2 rounded-lg border border-line bg-white p-2.5 text-[11px] leading-snug text-ink shadow-xl group-hover:block">
      <div className="font-semibold">{s.name}</div>
      {s.description && <div className="mt-0.5 line-clamp-3 text-muted">{s.description}</div>}
      {s.roles.length > 0 && <div className="mt-1"><b>Who:</b> {s.roles.map((r) => `${r.role} (${r.raci})`).join(", ")}</div>}
      {s.systems.length > 0 && <div><b>Systems:</b> {s.systems.join(", ")}</div>}
      {s.painPoints.length > 0 && <div className="text-pain"><b>Pain:</b> {s.painPoints[0]}</div>}
      <div className="mt-1 text-muted">Click for details</div>
    </div>
  );
}

function EvidenceStrip({ ev }: { ev: EvNode }) {
  if (!ev.observed) return <div className="mt-1 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-muted">Not observed in event log</div>;
  return (
    <div className="mt-1 flex items-center gap-2 rounded px-1.5 py-0.5 text-[10px] font-semibold"
      style={{ background: `rgba(217,59,59,${(0.06 + ev.heat * 0.3).toFixed(2)})`, color: ev.heat > 0.6 ? "#9b1c1c" : "#334155" }}>
      <span className="flex items-center gap-0.5" title="Cases that passed through this step"><Users size={10} />{ev.cases.toLocaleString()}</span>
      <span className="flex items-center gap-0.5" title="Median wait before this step"><Clock size={10} />{fmtHrs(ev.wait)}</span>
      {ev.rework > 0 && <span className="flex items-center gap-0.5" title="Cases repeating this step (rework)"><Repeat size={10} />{Math.round(ev.rework * 100)}%</span>}
    </div>
  );
}

function FlowNode({ data }: NodeProps<Node<StepData>>) {
  const d = data;
  const fade = d.dim ? "opacity-40" : "";

  if (d.kind === "start" || d.kind === "end") {
    return (
      <div className={`relative ${fade}`} style={{ width: d.w, height: d.h }} aria-label={d.kind === "start" ? "Start" : "End"}>
        <Handles />
        <div className={`h-full w-full rounded-full bg-white ${d.kind === "start" ? "border-2 border-control" : "border-[5px] border-pain"}`} />
        <span className="absolute left-1/2 top-full mt-1 -translate-x-1/2 text-[10px] font-semibold uppercase tracking-wide text-muted">{d.kind}</span>
      </div>
    );
  }

  const s = d.step!;
  const isGroup = s.id.startsWith("grp:");
  const diffBg = d.diff === "added" ? "#ecfdf3" : d.diff === "changed" ? "#fffbeb" : "#ffffff";

  if (d.kind === "decision") {
    return (
      <div className={`group relative ${fade}`} style={{ width: d.w, height: d.h }} role="button" aria-label={`Decision: ${s.name}`}>
        <Handles />
        <Tooltip s={s} />
        <svg width={d.w} height={d.h} className={`absolute inset-0 overflow-visible ${d.selected || d.active ? "drop-shadow-[0_0_4px_rgba(47,111,237,.8)]" : "drop-shadow-sm"}`} aria-hidden>
          <polygon points={`${d.w / 2},1 ${d.w - 1},${d.h / 2} ${d.w / 2},${d.h - 1} 1,${d.h / 2}`} fill={diffBg}
            stroke={d.selected || d.active ? "#2f6fed" : d.overlays.pain && s.painPoints.length ? "#d93b3b" : "#d98a00"} strokeWidth={d.selected || d.active ? 2.5 : 1.6} />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center px-8 text-center text-[11px] font-semibold leading-tight text-ink">
          <span className="line-clamp-3">{s.name}</span>
        </div>
        {!!d.hiddenAlt && <span className="absolute -right-2 -top-2 rounded-full border border-warn bg-white px-1.5 text-[10px] font-semibold text-[#8a5800]" title="Alternative branches hidden — switch to 'With exceptions' to see them">+{d.hiddenAlt}</span>}
        {d.ev && <div className="absolute left-1/2 top-full w-40 -translate-x-1/2"><EvidenceStrip ev={d.ev} /></div>}
      </div>
    );
  }

  const accent = isGroup || d.kind === "subprocess" ? "#7c4dff" : d.kind === "event" ? "#1f8f5f" : "#2f6fed";
  return (
    <div
      className={`group relative flex flex-col justify-between rounded-xl border px-3 py-2 text-left shadow-sm transition-shadow hover:shadow-md ${ring(d)} ${fade} ${d.kind === "event" ? "!rounded-full !p-0" : ""} ${d.secondary ? "!border-dashed !shadow-none" : ""}`}
      style={{ width: d.w, height: d.h, borderColor: d.ev && d.ev.heat > 0.6 ? "#d93b3b" : "#cfd6e4", borderTop: `3px solid ${d.secondary ? "#aab3c3" : accent}`, background: d.secondary ? "#fafbfd" : diffBg }}
      role="button" aria-label={`${s.type}: ${s.name}`}
    >
      <Handles />
      {!isGroup && <Tooltip s={s} />}
      <div className={`text-[12px] font-semibold leading-tight ${d.secondary ? "text-muted" : "text-ink"}`}><span className="line-clamp-2">{s.name}</span></div>
      {d.detailed && !isGroup && (
        <div className="mt-1 min-h-0 flex-1 space-y-0.5 overflow-hidden text-[10px] leading-snug text-muted">
          {s.description && <p className="line-clamp-2">{s.description}</p>}
          {s.rules[0] && <p className="line-clamp-1"><b className="text-ink">Rule:</b> {s.rules[0]}{s.rules.length > 1 ? ` (+${s.rules.length - 1})` : ""}</p>}
          {(s.inputs.length > 0 || s.outputs.length > 0) && <p className="line-clamp-1"><b className="text-ink">In:</b> {s.inputs.join(", ") || "—"} <b className="text-ink">→ Out:</b> {s.outputs.join(", ") || "—"}</p>}
          {s.systems.length > 0 && <p className="line-clamp-1"><b className="text-ink">Systems:</b> {s.systems.join(", ")}</p>}
        </div>
      )}
      <div className="flex items-center justify-between">
        <Badges s={s} badge={d.badge} />
        {(isGroup || d.kind === "subprocess") && (
          <span className="flex h-4 w-4 items-center justify-center rounded border border-auto text-auto" title={isGroup ? "Click to expand" : "Sub-process"}><Plus size={10} /></span>
        )}
      </div>
      {d.ev && <div className="absolute inset-x-0 top-full"><EvidenceStrip ev={d.ev} /></div>}
    </div>
  );
}

function LaneNode({ data }: NodeProps<Node<{ w: number; h: number; odd: boolean }>>) {
  return <div style={{ width: data.w, height: data.h }} className={`border-b border-[#dfe4ee] ${data.odd ? "bg-[#f7f9fc]" : "bg-white"}`} />;
}

const nodeTypes = { flow: FlowNode, lane: LaneNode };

const EDGE_COLOR: Record<Link["type"], string> = { sequence: "#5b6579", conditional: "#c27c00", handoff: "#2f6fed", exception: "#d93b3b" };

/** Lane titles pinned to the left edge while panning horizontally; click a title to zoom to that lane. */
function LaneHeaders({ lanes, width }: { lanes: { name: string; y: number; h: number }[]; width: number }) {
  const { y, zoom } = useViewport();
  const rf = useReactFlow();
  return (
    <div className="pointer-events-none absolute inset-y-0 left-0 z-[5]" style={{ width: Math.max(90, LANE_LABEL_W * zoom) }}>
      {lanes.map((l, i) => (
        <button key={l.name} type="button"
          className={`pointer-events-auto absolute left-0 flex w-full items-center border-b border-r-2 border-[#dfe4ee] border-r-[#c5cede] px-3 text-left text-[12px] font-semibold text-ink hover:text-brand ${i % 2 ? "bg-[#eef2f8]" : "bg-[#f4f6fa]"}`}
          style={{ top: l.y * zoom + y, height: l.h * zoom }}
          title={`Zoom to ${l.name}`}
          onClick={() => rf.fitBounds({ x: 0, y: l.y, width, height: l.h }, { padding: 0.05, duration: 400 })}>
          <span className="line-clamp-3">{l.name}</span>
        </button>
      ))}
    </div>
  );
}

function Legend() {
  const [open, setOpen] = useState(false);
  return (
    <Panel position="bottom-left" className="!mb-3 !ml-14">
      <div className="rounded-lg border border-line bg-white/95 text-[11px] shadow-sm">
        <button className="flex items-center gap-1 px-2.5 py-1.5 font-semibold text-muted hover:text-ink" onClick={() => setOpen(!open)} aria-expanded={open}>
          <Info size={12} /> Legend
        </button>
        {open && (
          <ul className="grid grid-cols-2 gap-x-4 gap-y-1.5 border-t border-line px-3 py-2">
            <li className="flex items-center gap-2"><span className="h-3.5 w-6 rounded border border-[#cfd6e4] border-t-[3px] border-t-brand bg-white" />Task</li>
            <li className="flex items-center gap-2"><svg width="22" height="14"><polygon points="11,1 21,7 11,13 1,7" fill="#fff" stroke="#d98a00" strokeWidth="1.5" /></svg>Decision</li>
            <li className="flex items-center gap-2"><span className="h-3.5 w-6 rounded border border-[#cfd6e4] border-t-[3px] border-t-auto bg-white" />Sub-process</li>
            <li className="flex items-center gap-2"><span className="h-3 w-3 rounded-full border-2 border-control" /><span className="h-3 w-3 rounded-full border-[3px] border-pain" />Start / End</li>
            <li className="flex items-center gap-2"><span className="w-6 border-t-2 border-[#5b6579]" />Sequence</li>
            <li className="flex items-center gap-2"><span className="w-6 border-t-2 border-[#c27c00]" />Decision branch</li>
            <li className="flex items-center gap-2"><span className="w-6 border-t-2 border-brand" />Handoff</li>
            <li className="flex items-center gap-2"><span className="w-6 border-t-2 border-dashed border-pain" />Exception / loop</li>
            <li className="flex items-center gap-2"><span className="w-6 border-t-2 border-dotted border-slate-400" />Implied order</li>
            <li className="flex items-center gap-2"><span className="w-6 border-t-[3px] border-ink" />Main path</li>
            <li className="flex items-center gap-2"><Hand size={12} className="text-[#b45309]" />Manual workaround</li>
            <li className="flex items-center gap-2"><span className="w-6 border-t-2 border-dashed border-[#9333ea]" />Deviation (evidence)</li>
          </ul>
        )}
      </div>
    </Panel>
  );
}

export type FlowProps = {
  steps: Step[]; links: Link[]; by: LaneBy; matches: Set<string> | null; selectedId?: string | null; activeId?: string | null;
  overlays: Overlays; badges?: Record<string, StepBadge>; diff?: Record<string, "added" | "changed">; onSelect: (id: string | null) => void;
  focus?: Focus | null;
  detailed?: boolean;
  /** main path emphasis: on-path edges bold, off-path steps styled as secondary */
  main?: Focus | null;
  hiddenAlt?: Record<string, number>;
  evidence?: EvidenceStats | null;
};

const MIN_READABLE = 0.6;

function Inner(p: FlowProps) {
  const rf = useReactFlow();
  const box = useRef<HTMLDivElement>(null);
  const layout = useMemo(() => layoutSteps(p.steps, p.links, p.by, { detailed: p.detailed }), [p.steps, p.links, p.by, p.detailed]);
  const maxWait = useMemo(() => Math.max(1, ...Object.values(p.evidence?.steps ?? {}).map((x) => x.medianWaitHrs)), [p.evidence]);
  const maxEdge = useMemo(() => Math.max(1, ...Object.values(p.evidence?.edges ?? {}).map((x) => x.count)), [p.evidence]);
  const byId = useMemo(() => new Map<string, Placed>(layout.nodes.map((n) => [n.id, n])), [layout]);

  const nodes: Node[] = useMemo(() => {
    const lanes: Node[] = layout.lanes.map((l, i) => ({
      id: `lane-${l.name}`, type: "lane", position: { x: 0, y: l.y }, width: layout.width, height: l.h, data: { w: layout.width, h: l.h, odd: i % 2 === 1 },
      draggable: false, selectable: false, focusable: false, zIndex: -1,
    }));
    const steps: Node[] = layout.nodes.map((n) => {
      const sid = n.step?.id ?? n.id;
      return {
        id: n.id, type: "flow", position: { x: n.x, y: n.y }, width: n.w, height: n.h, draggable: false, selectable: !!n.step,
        data: {
          step: n.step, kind: n.kind, w: n.w, h: n.h,
          dim: !!n.step && ((!!p.matches && !p.matches.has(sid)) || (!!p.focus && !p.focus.nodes.has(sid))),
          selected: p.selectedId === sid, active: p.activeId === sid,
          overlays: p.overlays, badge: p.badges?.[sid], diff: p.diff?.[sid],
          detailed: p.detailed, secondary: !!p.main && !!n.step && !p.main.nodes.has(sid), hiddenAlt: p.hiddenAlt?.[sid],
          ev: p.evidence && n.step && !sid.startsWith("grp:") ? (() => {
            const e = p.evidence!.steps[sid];
            return e ? { cases: e.cases, wait: e.medianWaitHrs, rework: e.cases ? e.reworkCases / e.cases : 0, heat: e.medianWaitHrs / maxWait, observed: true }
              : { cases: 0, wait: 0, rework: 0, heat: 0, observed: false };
          })() : undefined,
        } satisfies StepData,
      };
    });
    return [...lanes, ...steps];
  }, [layout, p.matches, p.focus, p.selectedId, p.activeId, p.overlays, p.badges, p.diff, p.detailed, p.main, p.hiddenAlt, p.evidence, maxWait]);

  const edges: Edge[] = useMemo(() => layout.links.map((l) => {
    const a = byId.get(l.from)!, b = byId.get(l.to)!;
    const synthetic = !a.step || !b.step;
    const crossing = !synthetic && laneOf(a.step!, p.by) !== laneOf(b.step!, p.by);
    const hand = p.overlays.handoffs && !synthetic && (l.type === "handoff" || crossing);
    const inFocus = !p.focus ? true : synthetic ? false : p.focus.edges.has(l.id);
    const deviation = l.id.startsWith("dev_");
    const onMain = !!p.main && (p.main.edges.has(l.id) || (synthetic && (p.main.nodes.has(l.from) || p.main.nodes.has(l.to))));
    const ev = p.evidence?.edges[`${l.from}>${l.to}`];
    const color = deviation ? "#9333ea" : synthetic ? "#9aa4b5" : hand ? "#2f6fed" : onMain ? "#1b2236" : l.implied ? "#9aa4b5" : EDGE_COLOR[l.type];
    const label = deviation ? `deviation · ${l.condition}` : ev ? `${ev.count.toLocaleString()}${l.condition ? ` · ${l.condition}` : ""}` : hand ? `⇄ ${l.condition || "handoff"}` : l.condition || undefined;
    const evWidth = ev ? 1.5 + 6 * (ev.count / maxEdge) : 0;
    const sw = evWidth || (hand ? 2.8 : onMain ? 2.8 : p.focus && inFocus ? 2.4 : 1.6);
    const mk = Math.max(7, (16 * 1.6) / sw); // markers scale with stroke width; keep arrowheads a constant size
    return {
      id: l.id, source: l.from, target: l.to, sourceHandle: `s-${l.sourceSide}`, targetHandle: `t-${l.targetSide}`,
      type: "smoothstep", pathOptions: { borderRadius: 10, offset: l.back ? 28 : 18 },
      label, labelShowBg: true, labelBgPadding: [5, 2] as [number, number], labelBgBorderRadius: 4,
      labelStyle: { fontSize: 10.5, fill: hand ? "#1d4ed8" : l.type === "conditional" ? "#8a5800" : "#334155", fontWeight: 600 },
      labelBgStyle: { fill: "#ffffff", stroke: "#e2e6ee" },
      style: {
        stroke: color, strokeWidth: sw,
        opacity: !inFocus ? 0.25 : p.main && !onMain && !synthetic ? 0.55 : p.evidence && !ev && !synthetic && !deviation ? 0.35 : 1,
        strokeDasharray: deviation ? "4 3" : l.implied ? "2 4" : l.type === "exception" || l.back ? "6 4" : undefined,
      },
      markerEnd: { type: MarkerType.ArrowClosed, color, width: mk, height: mk },
      animated: !!p.focus && inFocus && !synthetic,
    } as Edge;
  }), [layout, byId, p.overlays.handoffs, p.focus, p.by, p.main, p.evidence, maxEdge]);

  // readable initial viewport: never shrink below MIN_READABLE; wide flows start at the left and scroll
  const fitKey = `${p.by}|${layout.nodes.length}|${layout.lanes.length}|${p.detailed}`;
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const t = setTimeout(() => {
      const W = el.clientWidth, H = el.clientHeight;
      const fit = Math.min(W / (layout.width + 20), H / (layout.height + 20), 1);
      const zoom = Math.max(MIN_READABLE, fit);
      const x = layout.width * zoom < W ? (W - layout.width * zoom) / 2 : 0;
      const y = layout.height * zoom < H ? (H - layout.height * zoom) / 2 : 0;
      rf.setViewport({ x, y, zoom }, { duration: 0 });
    }, 30);
    return () => clearTimeout(t);
  }, [fitKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // walkthrough / keyboard focus: keep the active node in view
  const centerOn = (id: string) => {
    const n = byId.get(id);
    if (n) rf.setCenter(n.x + n.w / 2, n.y + n.h / 2, { zoom: Math.max(rf.getZoom(), 0.9), duration: 400 });
  };
  useEffect(() => { if (p.activeId) centerOn(p.activeId); }, [p.activeId]); // eslint-disable-line react-hooks/exhaustive-deps
  // re-centre on selection once the details panel has opened and the canvas has resized
  useEffect(() => {
    if (!p.selectedId) return;
    const t = setTimeout(() => centerOn(p.selectedId!), 120);
    return () => clearTimeout(t);
  }, [p.selectedId]); // eslint-disable-line react-hooks/exhaustive-deps

  function onKey(e: React.KeyboardEvent) {
    if (!["ArrowRight", "ArrowLeft", "ArrowUp", "ArrowDown", "Escape"].includes(e.key)) return;
    e.preventDefault();
    if (e.key === "Escape") return p.onSelect(null);
    const order = layout.order;
    const cur = p.selectedId;
    let next: string | undefined;
    if (!cur) next = order[0]?.id;
    else if (e.key === "ArrowRight") next = layout.links.find((l) => l.from === cur && byId.get(l.to)?.step)?.to;
    else if (e.key === "ArrowLeft") next = layout.links.find((l) => l.to === cur && byId.get(l.from)?.step)?.from;
    else {
      const i = order.findIndex((s) => s.id === cur);
      next = order[Math.max(0, Math.min(order.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)))]?.id;
    }
    if (next) p.onSelect(next);
  }

  return (
    <div ref={box} className="h-full w-full outline-none" tabIndex={0} onKeyDown={onKey} aria-label="Process diagram. Use arrow keys to move between steps.">
      <ReactFlow
        nodes={nodes} edges={edges} nodeTypes={nodeTypes} minZoom={0.15} maxZoom={2}
        nodesDraggable={false} nodesConnectable={false} elementsSelectable
        onNodeClick={(_, n) => { if (n.type === "flow" && (n.data as StepData).step) p.onSelect((n.data as StepData).step!.id); }}
        onPaneClick={() => p.onSelect(null)} proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="#d9dee8" />
        <LaneHeaders lanes={layout.lanes} width={layout.width} />
        <Controls showInteractive={false} position="bottom-left" />
        <MiniMap pannable zoomable position="bottom-right" nodeColor={(n) => (n.type === "lane" ? "#f1f4f9" : "#2f6fed")} nodeStrokeColor={(n) => (n.type === "lane" ? "#dfe4ee" : "#2f6fed")} nodeBorderRadius={4} maskColor="rgba(240,243,248,.7)" />
        <Legend />
      </ReactFlow>
    </div>
  );
}

export function FlowCanvas(p: FlowProps) {
  if (!p.steps.length) return <div className="grid h-full place-items-center text-sm text-muted">No steps in this scope.</div>;
  return <ReactFlowProvider><Inner {...p} /></ReactFlowProvider>;
}
