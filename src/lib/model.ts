import { z } from "zod";

export const LEVELS = ["L0", "L1", "L2", "L3"] as const;
export const STEP_TYPES = ["task", "decision", "event", "subprocess"] as const;
export const LINK_TYPES = ["sequence", "conditional", "handoff", "exception"] as const;
export const AUTOMATION_TAGS = ["none", "RPA", "AI", "Integration", "Workflow"] as const;

export const ProcessSchema = z.object({
  id: z.string(),
  name: z.string(),
  level: z.enum(LEVELS),
  parentId: z.string().nullable(),
  owner: z.string(),
  objective: z.string(),
  scope: z.string(),
  kpis: z.array(z.string()),
});

export const StepSchema = z.object({
  id: z.string(),
  processId: z.string(),
  name: z.string(),
  type: z.enum(STEP_TYPES),
  description: z.string(),
  roles: z.array(z.object({ role: z.string(), raci: z.enum(["R", "A", "C", "I"]) })),
  systems: z.array(z.string()),
  inputs: z.array(z.string()),
  outputs: z.array(z.string()),
  rules: z.array(z.string()),
  sla: z.string(),
  controls: z.array(z.string()),
  painPoints: z.array(z.string()),
  automationTag: z.enum(AUTOMATION_TAGS),
  automationRationale: z.string(),
  confidence: z.number(),
  sourceRef: z.string(),
});

export const LinkSchema = z.object({
  id: z.string(),
  from: z.string(),
  to: z.string(),
  type: z.enum(LINK_TYPES),
  condition: z.string(),
});

export const ProcessModelSchema = z.object({
  title: z.string(),
  processes: z.array(ProcessSchema),
  steps: z.array(StepSchema),
  links: z.array(LinkSchema),
  roles: z.array(z.object({ id: z.string(), name: z.string(), department: z.string() })),
  systems: z.array(z.object({ id: z.string(), name: z.string(), type: z.string(), integrations: z.array(z.string()) })),
});

export type Process = z.infer<typeof ProcessSchema>;
export type Step = z.infer<typeof StepSchema>;
export type Link = z.infer<typeof LinkSchema>;
export type ProcessModel = z.infer<typeof ProcessModelSchema>;

export const emptyModel = (title = "Untitled"): ProcessModel => ({
  title,
  processes: [],
  steps: [],
  links: [],
  roles: [],
  systems: [],
});

export const LOW_CONFIDENCE = 0.7;

export function uid(prefix = "x") {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Make the model internally consistent: valid refs, deduped roles/systems, a single L0 root. */
export function normalizeModel(m: ProcessModel): ProcessModel {
  const model: ProcessModel = JSON.parse(JSON.stringify(m));
  const pids = new Set(model.processes.map((p) => p.id));

  if (!model.processes.some((p) => p.level === "L0")) {
    const root: Process = {
      id: "p_root", name: model.title || "Process landscape", level: "L0", parentId: null,
      owner: "", objective: "", scope: "", kpis: [],
    };
    model.processes.unshift(root);
    pids.add(root.id);
  }
  const root = model.processes.find((p) => p.level === "L0")!;
  const rank = { L0: 0, L1: 1, L2: 2, L3: 3 } as const;
  for (const p of model.processes) {
    if (p.level === "L0") { p.parentId = null; continue; }
    if (!p.parentId || !pids.has(p.parentId) || p.parentId === p.id) p.parentId = root.id;
    const parent = model.processes.find((x) => x.id === p.parentId)!;
    if (rank[parent.level] >= rank[p.level]) {
      p.level = LEVELS[Math.min(3, rank[parent.level] + 1)];
    }
  }

  // steps need a valid process
  const fallback = model.processes.find((p) => p.level === "L1") ?? root;
  for (const s of model.steps) {
    if (!pids.has(s.processId)) s.processId = fallback.id;
    s.confidence = Math.max(0, Math.min(1, Number.isFinite(s.confidence) ? s.confidence : 0.5));
  }
  const sids = new Set(model.steps.map((s) => s.id));
  const seen = new Set<string>();
  model.links = model.links.filter((l) => {
    if (!sids.has(l.from) || !sids.has(l.to) || l.from === l.to) return false;
    const k = `${l.from}>${l.to}>${l.condition}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  // derive/dedupe roles and systems from step usage
  const roleMap = new Map<string, { id: string; name: string; department: string }>();
  for (const r of model.roles) roleMap.set(norm(r.name), r);
  const sysMap = new Map<string, { id: string; name: string; type: string; integrations: string[] }>();
  for (const s of model.systems) sysMap.set(norm(s.name), s);
  for (const st of model.steps) {
    st.roles = st.roles.map((r) => {
      const k = norm(r.role);
      if (!roleMap.has(k)) roleMap.set(k, { id: uid("r"), name: r.role.trim(), department: "" });
      return { ...r, role: roleMap.get(k)!.name };
    }).filter((r) => r.role);
    st.systems = st.systems.map((n) => {
      const k = norm(n);
      if (!sysMap.has(k)) sysMap.set(k, { id: uid("s"), name: n.trim(), type: "", integrations: [] });
      return sysMap.get(k)!.name;
    }).filter(Boolean);
  }
  model.roles = [...roleMap.values()].filter((r) => r.name);
  model.systems = [...sysMap.values()].filter((s) => s.name);
  return model;
}

export const childrenOf = (m: ProcessModel, id: string | null) => m.processes.filter((p) => p.parentId === id);

/** All descendant process ids including self. */
export function descendantIds(m: ProcessModel, id: string): Set<string> {
  const out = new Set<string>([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const p of m.processes) if (p.parentId && out.has(p.parentId) && !out.has(p.id)) { out.add(p.id); grew = true; }
  }
  return out;
}

export function processPath(m: ProcessModel, id: string): Process[] {
  const path: Process[] = [];
  let cur = m.processes.find((p) => p.id === id);
  while (cur) { path.unshift(cur); cur = cur.parentId ? m.processes.find((p) => p.id === cur!.parentId) : undefined; }
  return path;
}

export type DiffResult = {
  added: string[]; removed: string[]; changed: string[];
  details: Record<string, string[]>;
};

/** Compare steps between two models (FR-14). Matches by id then by normalised name. */
export function diffModels(a: ProcessModel, b: ProcessModel): DiffResult {
  const key = (s: Step) => norm(s.name);
  const aBy = new Map(a.steps.map((s) => [s.id, s]));
  const aByName = new Map(a.steps.map((s) => [key(s), s]));
  const matchedA = new Set<string>();
  const res: DiffResult = { added: [], removed: [], changed: [], details: {} };
  const fields: (keyof Step)[] = ["description", "roles", "systems", "inputs", "outputs", "rules", "sla", "controls", "painPoints", "automationTag", "type", "processId"];
  for (const s of b.steps) {
    const prev = aBy.get(s.id) ?? aByName.get(key(s));
    if (!prev) { res.added.push(s.id); continue; }
    matchedA.add(prev.id);
    const diffs = [
      ...(prev.name !== s.name ? ["name"] : []),
      ...fields.filter((f) => JSON.stringify(prev[f]) !== JSON.stringify(s[f])).map(String),
    ];
    if (diffs.length) { res.changed.push(s.id); res.details[s.id] = diffs; }
  }
  for (const s of a.steps) if (!matchedA.has(s.id)) res.removed.push(s.id);
  return res;
}
