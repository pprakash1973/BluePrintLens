import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
import PptxGenJS from "pptxgenjs";
import { getVersionModel } from "@/lib/bp";
import { childrenOf, processPath, type ProcessModel } from "@/lib/model";

export const maxDuration = 60;
type Ctx = { params: Promise<{ id: string }> };

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const xid = (s: string) => "id_" + s.replace(/[^A-Za-z0-9_]/g, "_");

function bpmn(m: ProcessModel): string {
  const procs = m.processes.filter((p) => m.steps.some((s) => s.processId === p.id));
  const body = procs.map((p) => {
    const steps = m.steps.filter((s) => s.processId === p.id);
    const ids = new Set(steps.map((s) => s.id));
    const links = m.links.filter((l) => ids.has(l.from) && ids.has(l.to));
    const hasIn = new Set(links.map((l) => l.to));
    const hasOut = new Set(links.map((l) => l.from));
    const nodes = steps.map((s) => {
      const tag = s.type === "decision" ? "exclusiveGateway" : s.type === "event" ? "intermediateCatchEvent" : s.type === "subprocess" ? "callActivity" : "task";
      return `    <${tag} id="${xid(s.id)}" name="${esc(s.name)}"><documentation>${esc(s.description)}</documentation></${tag}>`;
    });
    const starts = steps.filter((s) => !hasIn.has(s.id));
    const ends = steps.filter((s) => !hasOut.has(s.id));
    const flows = links.map((l) => `    <sequenceFlow id="${xid(l.id)}" sourceRef="${xid(l.from)}" targetRef="${xid(l.to)}"${l.condition ? ` name="${esc(l.condition)}"` : ""}/>`);
    starts.forEach((s, i) => { nodes.push(`    <startEvent id="start_${xid(p.id)}_${i}"/>`); flows.push(`    <sequenceFlow id="sfs_${xid(p.id)}_${i}" sourceRef="start_${xid(p.id)}_${i}" targetRef="${xid(s.id)}"/>`); });
    ends.forEach((s, i) => { nodes.push(`    <endEvent id="end_${xid(p.id)}_${i}"/>`); flows.push(`    <sequenceFlow id="sfe_${xid(p.id)}_${i}" sourceRef="${xid(s.id)}" targetRef="end_${xid(p.id)}_${i}"/>`); });
    return `  <process id="${xid(p.id)}" name="${esc(p.name)}" isExecutable="false">\n${nodes.join("\n")}\n${flows.join("\n")}\n  </process>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL" targetNamespace="https://blueprintlens/${xid(m.title)}" id="defs">\n${body.join("\n")}\n</definitions>\n`;
}

async function raci(m: ProcessModel) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("RACI");
  ws.columns = [{ header: "Process", width: 30 }, { header: "Step", width: 40 }, ...m.roles.map((r) => ({ header: r.name, width: 14 }))];
  const procName = new Map(m.processes.map((p) => [p.id, p.name]));
  for (const s of m.steps) ws.addRow([procName.get(s.processId) ?? "", s.name, ...m.roles.map((r) => s.roles.filter((x) => x.role === r.name).map((x) => x.raci).join("/"))]);
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: "frozen", xSplit: 2, ySplit: 1 }];
  return wb;
}

async function backlog(m: ProcessModel) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Automation backlog");
  ws.columns = [
    { header: "Process", width: 28 }, { header: "Step", width: 38 }, { header: "Automation type", width: 16 }, { header: "Rationale", width: 50 },
    { header: "Pain points", width: 50 }, { header: "Systems", width: 24 }, { header: "Roles", width: 28 }, { header: "SLA", width: 16 }, { header: "Confidence", width: 12 },
  ];
  const procName = new Map(m.processes.map((p) => [p.id, p.name]));
  for (const s of m.steps.filter((x) => x.automationTag !== "none")) {
    ws.addRow([procName.get(s.processId), s.name, s.automationTag, s.automationRationale, s.painPoints.join("; "), s.systems.join(", "), s.roles.map((r) => r.role).join(", "), s.sla, s.confidence]);
  }
  ws.getRow(1).font = { bold: true };
  return wb;
}

async function pptx(m: ProcessModel) {
  const p = new PptxGenJS();
  p.layout = "LAYOUT_WIDE";
  const t = p.addSlide();
  t.addText(m.title, { x: 0.6, y: 2.3, w: 12, h: 1, fontSize: 36, bold: true, color: "1F2A44" });
  t.addText(`${m.processes.length} processes · ${m.steps.length} steps · ${m.roles.length} roles · ${m.systems.length} systems`, { x: 0.6, y: 3.4, w: 12, h: 0.5, fontSize: 16, color: "666666" });
  const root = m.processes.find((x) => x.level === "L0");
  if (root) {
    const o = p.addSlide();
    o.addText(`${root.name} — value chain`, { x: 0.5, y: 0.3, w: 12, h: 0.6, fontSize: 24, bold: true, color: "1F2A44" });
    const l1 = childrenOf(m, root.id);
    const w = Math.min(2.4, 12.2 / Math.max(1, l1.length));
    l1.forEach((x, i) => {
      o.addShape(p.ShapeType.chevron, { x: 0.5 + i * (w + 0.05), y: 1.4, w, h: 1.1, fill: { color: "2F6FED" } });
      o.addText(x.name, { x: 0.5 + i * (w + 0.05) + 0.25, y: 1.4, w: w - 0.5, h: 1.1, fontSize: 12, color: "FFFFFF", bold: true, align: "center", valign: "middle" });
    });
  }
  for (const proc of m.processes.filter((x) => x.level !== "L0" && m.steps.some((s) => s.processId === x.id))) {
    const s = p.addSlide();
    s.addText(processPath(m, proc.id).slice(1).map((x) => x.name).join(" › "), { x: 0.5, y: 0.3, w: 12.3, h: 0.6, fontSize: 20, bold: true, color: "1F2A44" });
    const rows: PptxGenJS.TableRow[] = [["Step", "Roles", "Systems", "Pain points"].map((h) => ({ text: h, options: { bold: true, fill: { color: "E8EEFB" } } }))];
    for (const st of m.steps.filter((x) => x.processId === proc.id).slice(0, 12)) {
      rows.push([st.name, st.roles.map((r) => `${r.role} (${r.raci})`).join(", "), st.systems.join(", "), st.painPoints.join("; ")].map((text) => ({ text, options: { fontSize: 10 } })));
    }
    s.addTable(rows, { x: 0.5, y: 1.1, w: 12.3, colW: [3.5, 3, 2.3, 3.5], border: { type: "solid", color: "CCCCCC", pt: 0.5 } });
  }
  return p;
}

export async function GET(req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const sp = req.nextUrl.searchParams;
  const r = await getVersionModel(id, sp.get("v") ?? "latest");
  if (!r) return NextResponse.json({ error: "No published version" }, { status: 404 });
  const m = r.model;
  const safe = m.title.replace(/[^a-zA-Z0-9]+/g, "_").slice(0, 40) || "blueprint";
  const fmt = sp.get("format");
  const dl = (body: BodyInit, type: string, ext: string) =>
    new NextResponse(body, { headers: { "Content-Type": type, "Content-Disposition": `attachment; filename="${safe}.${ext}"` } });

  if (fmt === "bpmn") return dl(bpmn(m), "application/xml", "bpmn");
  if (fmt === "raci") return dl(Buffer.from(await (await raci(m)).xlsx.writeBuffer()), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "raci.xlsx");
  if (fmt === "backlog") return dl(Buffer.from(await (await backlog(m)).xlsx.writeBuffer()), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "backlog.xlsx");
  if (fmt === "pptx") return dl(Buffer.from((await (await pptx(m)).write({ outputType: "nodebuffer" })) as Buffer), "application/vnd.openxmlformats-officedocument.presentationml.presentation", "pptx");
  return NextResponse.json({ error: "Unknown format" }, { status: 400 });
}
