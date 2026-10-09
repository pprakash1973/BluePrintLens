import { normalizeModel, type ProcessModel, type Step } from "./model";

type S = Partial<Step> & { id: string; processId: string; name: string };
const step = (s: S): Step => ({
  type: "task", description: "", roles: [], systems: [], inputs: [], outputs: [], rules: [], sla: "", controls: [],
  painPoints: [], automationTag: "none", automationRationale: "", confidence: 0.92, sourceRef: "", ...s,
});
const R = (role: string, raci: "R" | "A" | "C" | "I" = "R") => ({ role, raci });

/** Sample Order-to-Cash blueprint used for demos and tests. */
export function sampleModel(): ProcessModel {
  const steps: Step[] = [
    step({ id: "s1", processId: "p21", name: "Receive customer order", description: "Capture the purchase order received by email or EDI.", roles: [R("Sales Admin"), R("Sales Manager", "A")], systems: ["Salesforce", "Email"], inputs: ["Customer PO"], outputs: ["Order request"], sla: "Within 2 hours", sourceRef: "§2.1 Order Capture", painPoints: ["Orders arrive in many formats and are re-keyed manually"], automationTag: "AI", automationRationale: "Extract PO fields from email/PDF automatically" }),
    step({ id: "s2", processId: "p21", name: "Validate order details", description: "Check customer, pricing, quantities and delivery terms.", roles: [R("Sales Admin"), R("Finance", "C")], systems: ["SAP"], inputs: ["Order request"], outputs: ["Validated order"], rules: ["Price must match active contract price list"], controls: ["Four-eyes check for orders above 50k"], sourceRef: "§2.1 Order Capture" }),
    step({ id: "s3", processId: "p21", name: "Order valid?", type: "decision", roles: [R("Sales Admin")], sourceRef: "§2.1 Order Capture", confidence: 0.85 }),
    step({ id: "s4", processId: "p21", name: "Request correction from customer", description: "Contact the customer to fix errors in the order.", roles: [R("Sales Admin"), R("Customer", "I")], systems: ["Email"], sourceRef: "§2.1 Order Capture", painPoints: ["Back-and-forth by email causes 2 day delays"], confidence: 0.8 }),
    step({ id: "s5", processId: "p22", name: "Check customer credit", description: "Run credit check against the customer limit.", roles: [R("Credit Analyst"), R("Finance Manager", "A")], systems: ["SAP", "Credit Bureau API"], inputs: ["Validated order"], outputs: ["Credit decision"], rules: ["Block if exposure exceeds limit by more than 10%"], controls: ["Credit limit override requires Finance Manager approval"], sla: "4 hours", sourceRef: "§2.2 Credit Management", automationTag: "Integration", automationRationale: "Credit bureau API can return decision automatically" }),
    step({ id: "s6", processId: "p22", name: "Credit approved?", type: "decision", roles: [R("Credit Analyst")], sourceRef: "§2.2 Credit Management" }),
    step({ id: "s7", processId: "p22", name: "Escalate credit exception", description: "Escalate to Finance Manager for manual review.", roles: [R("Finance Manager", "A"), R("Credit Analyst")], systems: ["SAP"], controls: ["Documented approval"], sourceRef: "§2.2 Credit Management", painPoints: ["Approvals happen over email with no audit trail"], confidence: 0.7 }),
    step({ id: "s8", processId: "p31", name: "Create sales order", description: "Create the confirmed sales order in the ERP.", roles: [R("Order Management"), R("Sales Admin", "I")], systems: ["SAP"], outputs: ["Sales order"], sourceRef: "§3.1 Fulfilment", automationTag: "RPA", automationRationale: "Rule-based data entry from validated order" }),
    step({ id: "s9", processId: "p31", name: "Pick and pack", description: "Warehouse picks items and prepares shipment.", roles: [R("Warehouse"), R("Logistics Manager", "A")], systems: ["WMS"], inputs: ["Sales order"], outputs: ["Packed shipment"], sla: "Same day if before 14:00", sourceRef: "§3.1 Fulfilment" }),
    step({ id: "s10", processId: "p31", name: "Ship goods", description: "Hand over to carrier and generate shipping documents.", roles: [R("Logistics"), R("Warehouse", "C")], systems: ["WMS", "Carrier Portal"], outputs: ["Delivery note"], sourceRef: "§3.1 Fulfilment", painPoints: ["Carrier portal data entered manually"], automationTag: "Integration", automationRationale: "Carrier APIs support booking and labels" }),
    step({ id: "s11", processId: "p32", name: "Confirm delivery", description: "Record proof of delivery from carrier.", roles: [R("Logistics")], systems: ["Carrier Portal", "SAP"], outputs: ["Proof of delivery"], sourceRef: "§3.2 Delivery Confirmation", confidence: 0.75 }),
    step({ id: "s12", processId: "p41", name: "Generate invoice", description: "Create customer invoice from the delivered order.", roles: [R("Billing"), R("Finance Manager", "A")], systems: ["SAP"], inputs: ["Proof of delivery"], outputs: ["Invoice"], rules: ["Invoice within 1 day of delivery"], controls: ["Invoice value must equal order value"], sourceRef: "§4.1 Billing", automationTag: "Workflow", automationRationale: "Triggered automatically on delivery confirmation" }),
    step({ id: "s13", processId: "p41", name: "Send invoice to customer", roles: [R("Billing")], systems: ["SAP", "Email"], sourceRef: "§4.1 Billing" }),
    step({ id: "s14", processId: "p42", name: "Match incoming payment", description: "Apply bank receipts to open invoices.", roles: [R("Accounts Receivable"), R("Finance Manager", "A")], systems: ["SAP", "Bank Portal"], sourceRef: "§4.2 Collections", painPoints: ["30% of payments need manual matching"], automationTag: "AI", automationRationale: "ML-based cash application for remittance matching" }),
    step({ id: "s15", processId: "p42", name: "Payment received?", type: "decision", roles: [R("Accounts Receivable")], sourceRef: "§4.2 Collections" }),
    step({ id: "s16", processId: "p42", name: "Send payment reminder", roles: [R("Accounts Receivable")], systems: ["SAP", "Email"], rules: ["Reminder at 7 days past due"], sourceRef: "§4.2 Collections", automationTag: "Workflow", automationRationale: "Dunning run can be scheduled" }),
    step({ id: "s17", processId: "p42", name: "Close invoice", roles: [R("Accounts Receivable")], systems: ["SAP"], sourceRef: "§4.2 Collections" }),
  ];
  const L = (id: string, from: string, to: string, type: "sequence" | "conditional" | "handoff" | "exception" = "sequence", condition = "") => ({ id, from, to, type, condition });
  return normalizeModel({
    title: "Order to Cash",
    processes: [
      { id: "p0", name: "Order to Cash", level: "L0", parentId: null, owner: "CFO", objective: "Convert customer orders into cash efficiently and accurately", scope: "From order receipt to payment application", kpis: ["DSO", "Order cycle time", "Invoice accuracy"] },
      { id: "p2", name: "Order Management", level: "L1", parentId: "p0", owner: "Head of Sales Operations", objective: "Capture and validate orders", scope: "", kpis: ["Order accuracy"] },
      { id: "p21", name: "Order Capture", level: "L2", parentId: "p2", owner: "Sales Admin Lead", objective: "", scope: "", kpis: ["Orders captured within SLA"] },
      { id: "p22", name: "Credit Management", level: "L2", parentId: "p2", owner: "Finance Manager", objective: "", scope: "", kpis: ["Credit decision time"] },
      { id: "p3", name: "Fulfilment", level: "L1", parentId: "p0", owner: "Head of Logistics", objective: "Deliver goods on time", scope: "", kpis: ["OTIF"] },
      { id: "p31", name: "Pick, Pack and Ship", level: "L2", parentId: "p3", owner: "Warehouse Manager", objective: "", scope: "", kpis: [] },
      { id: "p32", name: "Delivery Confirmation", level: "L2", parentId: "p3", owner: "Logistics Manager", objective: "", scope: "", kpis: [] },
      { id: "p4", name: "Billing and Collections", level: "L1", parentId: "p0", owner: "Finance Director", objective: "Invoice accurately and collect on time", scope: "", kpis: ["DSO", "Overdue %"] },
      { id: "p41", name: "Billing", level: "L2", parentId: "p4", owner: "Billing Lead", objective: "", scope: "", kpis: [] },
      { id: "p42", name: "Collections", level: "L2", parentId: "p4", owner: "AR Lead", objective: "", scope: "", kpis: [] },
    ],
    steps,
    links: [
      L("l1", "s1", "s2"), L("l2", "s2", "s3"), L("l3", "s3", "s5", "conditional", "Yes"), L("l4", "s3", "s4", "conditional", "No"),
      L("l5", "s4", "s2", "exception", "Corrected"), L("l6", "s5", "s6"), L("l7", "s6", "s8", "conditional", "Approved"),
      L("l8", "s6", "s7", "conditional", "Exception"), L("l9", "s7", "s8", "handoff", "Approved by Finance Manager"),
      L("l10", "s8", "s9", "handoff"), L("l11", "s9", "s10"), L("l12", "s10", "s11", "handoff"), L("l13", "s11", "s12", "handoff"),
      L("l14", "s12", "s13"), L("l15", "s13", "s14"), L("l16", "s14", "s15"), L("l17", "s15", "s17", "conditional", "Yes"),
      L("l18", "s15", "s16", "conditional", "No"), L("l19", "s16", "s14", "exception", "After reminder"),
    ],
    roles: [],
    systems: [],
  });
}
