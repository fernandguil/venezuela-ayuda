// Proyección del audit trail público: solo action/occurred_at/source + campos
// PÚBLICOS que cambiaron. NUNCA PII (phone_private/contact/manage_token/
// risk_answers), forense (ip/user_agent) ni interno (verified_by/hidden/verified).
// La tabla se deriva POR EVENTO de event.resource_table; eventos de tablas no
// públicas (p.ej. collection_centers) se descartan. Corre: node --test scripts/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { projectHistory, projectHistoryEvent, FORBIDDEN_FIELDS } from "../src/lib/audit.mjs";

const before = {
  id: "abc", source: "cruzroja.org", source_url: "https://x", external_id: "e1",
  category: "medical", description: "herido", urgency: "MEDIUM", status: "OPEN",
  city: "Caracas", latitude: 10.5, longitude: -66.9, place_name: "Centro",
  items: null, contact: "+58412SECRETO", manage_token: "tok-secreto",
  created_at: "2026-06-26T10:00:00Z", hidden: false,
};

test("UPDATE: solo campos públicos que cambiaron, con from/to", () => {
  const after = { ...before, urgency: "CRITICAL", status: "IN_PROGRESS", contact: "+58OTRO" };
  const ev = projectHistoryEvent(
    { action: "UPDATE", occurred_at: "2026-06-26T11:00:00Z", source: "cruzroja.org", resource_table: "help_requests", before, after }
  );
  assert.equal(ev.action, "UPDATE");
  assert.equal(ev.source, "cruzroja.org");
  assert.deepEqual(ev.changes.urgency, { from: "MEDIUM", to: "CRITICAL" });
  assert.deepEqual(ev.changes.status, { from: "OPEN", to: "IN_PROGRESS" });
  // contact cambió pero es PII → no aparece
  assert.equal("contact" in ev.changes, false);
});

test("CREATE: before null → campos públicos presentes como cambios desde null", () => {
  const ev = projectHistoryEvent(
    { action: "CREATE", occurred_at: "t", source: "cruzroja.org", resource_table: "help_requests", before: null, after: before }
  );
  assert.equal(ev.action, "CREATE");
  assert.equal(ev.changes.category.from, null);
  assert.equal(ev.changes.category.to, "medical");
});

test("NUNCA expone PII ni forense en ningún cambio", () => {
  const after = {
    ...before,
    contact: "+58NUEVO", manage_token: "otro-tok", phone_private: "+58PRIV",
    risk_answers: { q1: "si" }, ip: "1.2.3.4", user_agent: "curl",
  };
  const ev = projectHistoryEvent(
    { action: "UPDATE", occurred_at: "t", source: "s", resource_table: "help_requests", before, after }
  );
  for (const f of FORBIDDEN_FIELDS) {
    assert.equal(f in ev.changes, false, `${f} no debe filtrarse`);
  }
  // tampoco metadata interna
  assert.equal("ip" in ev, false);
  assert.equal("user_agent" in ev, false);
  assert.equal("before" in ev, false);
  assert.equal("after" in ev, false);
});

test("metadata estática (id/created_at/source/source_url) no se reporta como cambio", () => {
  const after = { ...before, status: "RESOLVED" };
  const ev = projectHistoryEvent(
    { action: "UPDATE", occurred_at: "t", source: "s", resource_table: "help_requests", before, after }
  );
  for (const m of ["id", "created_at", "source", "source_url"]) {
    assert.equal(m in ev.changes, false, `${m} no es un cambio`);
  }
});

test("checkins: contact/phone_private/manage_token nunca aparecen", () => {
  const cBefore = { id: "1", name: "Ana", status: "LOOKING_FOR_SOMEONE", phone_private: "+58", manage_token: "t", message: "x", created_at: "t" };
  const cAfter = { ...cBefore, status: "SAFE", phone_private: "+59", found_at: "2026-06-26T12:00:00Z" };
  const ev = projectHistoryEvent({ action: "UPDATE", occurred_at: "t", source: "s", resource_table: "checkins", before: cBefore, after: cAfter });
  assert.deepEqual(ev.changes.status, { from: "LOOKING_FOR_SOMEONE", to: "SAFE" });
  assert.equal("phone_private" in ev.changes, false);
  assert.equal("manage_token" in ev.changes, false);
});

test("projectHistory mapea una lista de eventos preservando orden", () => {
  const evs = projectHistory(
    [
      { action: "CREATE", occurred_at: "t1", source: "s", resource_table: "help_requests", before: null, after: before },
      { action: "UPDATE", occurred_at: "t2", source: "s", resource_table: "help_requests", before, after: { ...before, status: "RESOLVED" } },
    ]
  );
  assert.equal(evs.length, 2);
  assert.equal(evs[0].action, "CREATE");
  assert.equal(evs[1].changes.status.to, "RESOLVED");
});

// ── P0/P1: defensa en profundidad para verified_by, hidden, verified ─────────

test("verified_by NUNCA aparece en changes aunque se inyecte crudo en el evento", () => {
  const dBefore = {
    id: "d1", place_name: "Edificio A", description: "grietas", severity: "HIGH",
    city: "Caracas", status: "PENDING", created_at: "t", verified_at: null,
    verified_by: null, risk_level: "AMARILLO", risk_priority: false,
  };
  const dAfter = {
    ...dBefore, status: "VERIFIED", verified_at: "2026-06-26T12:00:00Z",
    verified_by: "admin@leadsales.io", // EMAIL del admin: jamás debe salir
  };
  const ev = projectHistoryEvent({ action: "UPDATE", occurred_at: "t", source: "s", resource_table: "damaged_reports", before: dBefore, after: dAfter });
  // status y verified_at sí son públicos
  assert.deepEqual(ev.changes.status, { from: "PENDING", to: "VERIFIED" });
  assert.equal(ev.changes.verified_at.to, "2026-06-26T12:00:00Z");
  // verified_by NUNCA
  assert.equal("verified_by" in ev.changes, false);
});

test("hidden y verified nunca aparecen en changes", () => {
  const after = { ...before, status: "RESOLVED", hidden: true, verified: true };
  const ev = projectHistoryEvent({ action: "UPDATE", occurred_at: "t", source: "s", resource_table: "help_requests", before, after });
  assert.equal("hidden" in ev.changes, false);
  assert.equal("verified" in ev.changes, false);
});

test("evento de tabla no pública (collection_centers) se descarta (null)", () => {
  const ev = projectHistoryEvent({ action: "UPDATE", occurred_at: "t", source: "s", resource_table: "collection_centers", before: { id: "c1", name: "Centro" }, after: { id: "c1", name: "Centro 2" } });
  assert.equal(ev, null);
});

test("trail con tablas distintas: cada evento proyecta con SU tabla, no la del primero", () => {
  const dRow = { id: "d1", place_name: "Edif", description: "x", severity: "HIGH", city: "Caracas", status: "PENDING", created_at: "t", risk_level: "ROJO", risk_priority: true };
  const evs = projectHistory([
    // checkins: status SAFE
    { action: "UPDATE", occurred_at: "t1", source: "s", resource_table: "checkins", before: { id: "1", status: "LOOKING_FOR_SOMEONE", created_at: "t" }, after: { id: "1", status: "SAFE", created_at: "t" } },
    // damaged_reports: severity (no existe en checkins) — debe proyectarse con su propia whitelist
    { action: "UPDATE", occurred_at: "t2", source: "s", resource_table: "damaged_reports", before: dRow, after: { ...dRow, severity: "CRITICAL" } },
    // collection_centers: se descarta
    { action: "UPDATE", occurred_at: "t3", source: "s", resource_table: "collection_centers", before: { id: "c", name: "A" }, after: { id: "c", name: "B" } },
  ]);
  assert.equal(evs.length, 2); // collection_centers filtrado
  assert.deepEqual(evs[0].changes.status, { from: "LOOKING_FOR_SOMEONE", to: "SAFE" });
  // severity es público SOLO en damaged_reports; se proyecta porque se usó SU tabla
  assert.deepEqual(evs[1].changes.severity, { from: "HIGH", to: "CRITICAL" });
});
