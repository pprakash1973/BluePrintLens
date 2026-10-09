import type { ProcessModel } from "./model";
import { withImplied } from "./layout";

/** Aggregated process-mining statistics from an event log, mapped onto model steps. Small enough to store as JSON. */
export type EvidenceStats = {
  filename: string;
  cases: number;
  events: number;
  from: string;
  to: string;
  cycle: { medianHrs: number; p90Hrs: number; avgHrs: number };
  steps: Record<string, { cases: number; events: number; reworkCases: number; medianWaitHrs: number; avgWaitHrs: number }>;
  edges: Record<string, { count: number; medianHrs: number }>; // key "fromStepId>toStepId"
  deviations: { from: string; to: string; count: number }[]; // observed transitions not in the model
  variants: { path: string[]; count: number }[];
  conformance: number; // share of cases whose every transition exists in the model
  reworkRate: number; // share of cases with any repeated step
  unmatched: { activity: string; count: number }[];
  notObserved: string[]; // model steps with no events
};

export type ColumnMap = { caseId: number; activity: number; timestamp: number };

/** Minimal RFC-4180 CSV parser (quoted fields, embedded commas/newlines, ; or tab delimiters). */
export function parseCsv(text: string): string[][] {
  const first = text.split(/\r?\n/, 1)[0] ?? "";
  const delim = [",", ";", "\t"].sort((a, b) => first.split(b).length - first.split(a).length)[0];
  const rows: string[][] = [];
  let row: string[] = [], field = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') q = false;
      else field += c;
    } else if (c === '"') q = true;
    else if (c === delim) { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((x) => x.trim())) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((x) => x.trim())) rows.push(row);
  return rows;
}

export function guessColumns(header: string[]): ColumnMap {
  const find = (re: RegExp, fallback: number) => { const i = header.findIndex((h) => re.test(h.trim())); return i >= 0 ? i : fallback; };
  return {
    caseId: find(/^(case|case[ _-]?id|order|order[ _-]?id|trace|instance|id)$/i, 0),
    activity: find(/^(activity|activity[ _-]?name|event|step|task|action|concept:name)$/i, 1),
    timestamp: find(/^(timestamp|time|date|datetime|start|start[ _-]?time|end[ _-]?time|complete|time:timestamp)$/i, 2),
  };
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const tokens = (s: string) => new Set(norm(s).split(" ").filter((t) => t.length > 2));

/** Map each distinct activity name to the best-matching step (exact → contains → token overlap). */
export function autoMatch(activities: string[], model: ProcessModel): Record<string, string | null> {
  const res: Record<string, string | null> = {};
  for (const a of activities) {
    const na = norm(a);
    let hit = model.steps.find((s) => norm(s.name) === na);
    if (!hit) hit = model.steps.find((s) => norm(s.name).includes(na) || na.includes(norm(s.name)));
    if (!hit) {
      const ta = tokens(a);
      let best = 0;
      for (const s of model.steps) {
        const ts = tokens(s.name);
        const inter = [...ta].filter((t) => ts.has(t)).length;
        const j = inter / Math.max(1, new Set([...ta, ...ts]).size);
        if (j > best) { best = j; hit = j >= 0.4 ? s : hit; }
      }
    }
    res[a] = hit?.id ?? null;
  }
  return res;
}

const median = (xs: number[]) => { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const pct = (xs: number[], p: number) => { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const round = (n: number) => Math.round(n * 10) / 10;

export function computeEvidence(rows: string[][], cols: ColumnMap, mapping: Record<string, string | null>, model: ProcessModel, filename: string): EvidenceStats {
  const byCase = new Map<string, { t: number; step: string | null; act: string }[]>();
  let events = 0, minT = Infinity, maxT = -Infinity;
  const unmatchedCount = new Map<string, number>();
  for (const r of rows) {
    const cid = r[cols.caseId]?.trim(), act = r[cols.activity]?.trim(), ts = Date.parse(r[cols.timestamp]?.trim() ?? "");
    if (!cid || !act || Number.isNaN(ts)) continue;
    events++; minT = Math.min(minT, ts); maxT = Math.max(maxT, ts);
    const step = mapping[act] ?? null;
    if (!step) unmatchedCount.set(act, (unmatchedCount.get(act) ?? 0) + 1);
    if (!byCase.has(cid)) byCase.set(cid, []);
    byCase.get(cid)!.push({ t: ts, step, act });
  }
  // documented links plus the implied document order between otherwise unconnected steps
  const modelEdges = new Set(withImplied(model.steps, model.links).links.map((l) => `${l.from}>${l.to}`));
  const H = 3_600_000;
  const stepAgg = new Map<string, { cases: Set<string>; events: number; rework: Set<string>; waits: number[] }>();
  const edgeAgg = new Map<string, number[]>();
  const devAgg = new Map<string, number>();
  const variantAgg = new Map<string, number>();
  const cycles: number[] = [];
  let conformant = 0, reworkCases = 0;

  for (const [cid, evs] of byCase) {
    evs.sort((a, b) => a.t - b.t);
    const mapped = evs.filter((e) => e.step);
    if (evs.length > 1) cycles.push((evs[evs.length - 1].t - evs[0].t) / H);
    const seen = new Set<string>();
    let rework = false, ok = true;
    mapped.forEach((e, i) => {
      const a = stepAgg.get(e.step!) ?? { cases: new Set(), events: 0, rework: new Set(), waits: [] };
      a.cases.add(cid); a.events++;
      if (seen.has(e.step!)) { a.rework.add(cid); rework = true; }
      seen.add(e.step!);
      if (i > 0) {
        const p = mapped[i - 1];
        a.waits.push((e.t - p.t) / H);
        const k = `${p.step}>${e.step}`;
        if (p.step !== e.step) {
          if (!edgeAgg.has(k)) edgeAgg.set(k, []);
          edgeAgg.get(k)!.push((e.t - p.t) / H);
          if (!modelEdges.has(k)) { ok = false; devAgg.set(k, (devAgg.get(k) ?? 0) + 1); }
        }
      }
      stepAgg.set(e.step!, a);
    });
    if (rework) reworkCases++;
    if (ok && mapped.length) conformant++;
    const v = mapped.map((e) => e.step).filter((s, i, arr) => s !== arr[i - 1]).join(">");
    if (v) variantAgg.set(v, (variantAgg.get(v) ?? 0) + 1);
  }
  const cases = byCase.size;
  const steps: EvidenceStats["steps"] = {};
  for (const [id, a] of stepAgg) {
    steps[id] = { cases: a.cases.size, events: a.events, reworkCases: a.rework.size, medianWaitHrs: round(median(a.waits)), avgWaitHrs: round(a.waits.reduce((x, y) => x + y, 0) / Math.max(1, a.waits.length)) };
  }
  const edges: EvidenceStats["edges"] = {};
  for (const [k, xs] of edgeAgg) edges[k] = { count: xs.length, medianHrs: round(median(xs)) };
  return {
    filename, cases, events,
    from: Number.isFinite(minT) ? new Date(minT).toISOString() : "", to: Number.isFinite(maxT) ? new Date(maxT).toISOString() : "",
    cycle: { medianHrs: round(median(cycles)), p90Hrs: round(pct(cycles, 0.9)), avgHrs: round(cycles.reduce((x, y) => x + y, 0) / Math.max(1, cycles.length)) },
    steps, edges,
    deviations: [...devAgg.entries()].map(([k, count]) => { const [from, to] = k.split(">"); return { from, to, count }; }).sort((a, b) => b.count - a.count).slice(0, 25),
    variants: [...variantAgg.entries()].map(([k, count]) => ({ path: k.split(">"), count })).sort((a, b) => b.count - a.count).slice(0, 10),
    conformance: cases ? conformant / cases : 0,
    reworkRate: cases ? reworkCases / cases : 0,
    unmatched: [...unmatchedCount.entries()].map(([activity, count]) => ({ activity, count })).sort((a, b) => b.count - a.count).slice(0, 30),
    notObserved: model.steps.filter((s) => !stepAgg.has(s.id)).map((s) => s.id),
  };
}

export const fmtHrs = (h: number) => (h >= 48 ? `${round(h / 24)}d` : h >= 1 ? `${round(h)}h` : `${Math.round(h * 60)}m`);

export const EVENT_LOG_TEMPLATE = "case_id,activity,timestamp,resource\nORD-1001,Receive PO by email / EDI / portal,2026-09-01T09:05:00Z,CS team\nORD-1001,Re-key order into ERP,2026-09-01T11:40:00Z,Order desk\n";
