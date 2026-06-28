// Proyección del audit trail público: solo action/occurred_at/source + campos
// PÚBLICOS que cambiaron. NUNCA PII (phone_private/contact/manage_token/
// risk_answers) ni forense (ip/user_agent). Corre: node --test scripts/*.test.mjs
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
    { action: "UPDATE", occurred_at: "2026-06-26T11:00:00Z", source: "cruzroja.org", before, after },
    "help_requests"
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
    { action: "CREATE", occurred_at: "t", source: "cruzroja.org", before: null, after: before },
    "help_requests"
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
    { action: "UPDATE", occurred_at: "t", source: "s", before, after },
    "help_requests"
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
    { action: "UPDATE", occurred_at: "t", source: "s", before, after },
    "help_requests"
  );
  for (const m of ["id", "created_at", "source", "source_url"]) {
    assert.equal(m in ev.changes, false, `${m} no es un cambio`);
  }
});

test("checkins: contact/phone_private/manage_token nunca aparecen", () => {
  const cBefore = { id: "1", name: "Ana", status: "LOOKING_FOR_SOMEONE", phone_private: "+58", manage_token: "t", message: "x", created_at: "t" };
  const cAfter = { ...cBefore, status: "SAFE", phone_private: "+59", found_at: "2026-06-26T12:00:00Z" };
  const ev = projectHistoryEvent({ action: "UPDATE", occurred_at: "t", source: "s", before: cBefore, after: cAfter }, "checkins");
  assert.deepEqual(ev.changes.status, { from: "LOOKING_FOR_SOMEONE", to: "SAFE" });
  assert.equal("phone_private" in ev.changes, false);
  assert.equal("manage_token" in ev.changes, false);
});

// B3: el /history es ANÓNIMO (sin API key). Los snapshots before/after del
// audit_log son CRUDOS (coord exacta). Estas pruebas blindan que ningún evento
// emita lat/lng de personas con más de 3 decimales.
function countDecimals(n) {
  if (typeof n !== "number" || !Number.isFinite(n)) return 0;
  const s = String(n);
  const i = s.indexOf(".");
  return i === -1 ? 0 : s.length - i - 1;
}

test("B3 history: CREATE de help_request redondea lat/lng a 3 decimales", () => {
  const exact = { ...before, latitude: 10.123456, longitude: -66.987654 };
  const ev = projectHistoryEvent(
    { action: "CREATE", occurred_at: "t", source: "cruzroja.org", before: null, after: exact },
    "help_requests"
  );
  assert.equal(ev.changes.latitude.to, 10.123);
  assert.equal(ev.changes.longitude.to, -66.988);
  assert.ok(countDecimals(ev.changes.latitude.to) <= 3);
  assert.ok(countDecimals(ev.changes.longitude.to) <= 3);
});

test("B3 history: cambio de coord sub-3-decimales NO aparece como edición", () => {
  const after = { ...before, latitude: 10.5004, longitude: -66.9001 };
  const ev = projectHistoryEvent(
    { action: "UPDATE", occurred_at: "t", source: "s", before, after },
    "help_requests"
  );
  // before.latitude=10.5, after=10.5004 → ambos redondean a 10.5 → sin cambio.
  assert.equal("latitude" in ev.changes, false);
  assert.equal("longitude" in ev.changes, false);
});

test("B3 history: checkins también redondea (from y to)", () => {
  const cBefore = { id: "1", name: "Ana", status: "LOOKING_FOR_SOMEONE", latitude: 10.111111, longitude: -66.222222, message: "x", created_at: "t" };
  const cAfter = { ...cBefore, latitude: 10.999999, longitude: -66.888888 };
  const ev = projectHistoryEvent({ action: "UPDATE", occurred_at: "t", source: "s", before: cBefore, after: cAfter }, "checkins");
  assert.deepEqual(ev.changes.latitude, { from: 10.111, to: 11 });
  assert.deepEqual(ev.changes.longitude, { from: -66.222, to: -66.889 });
});

test("B3 history: NINGÚN evento expone coord con >3 decimales (tablas de personas)", () => {
  const cases = [
    ["help_requests", { ...before, latitude: 10.1234567, longitude: -66.7654321 }],
    ["checkins", { id: "1", name: "x", status: "SAFE", latitude: 8.99999, longitude: -70.00001, created_at: "t" }],
    ["help_offers", { id: "2", category: "food", latitude: 9.123456, longitude: -67.654321, created_at: "t" }],
  ];
  for (const [table, after] of cases) {
    const ev = projectHistoryEvent({ action: "CREATE", occurred_at: "t", source: "s", before: null, after }, table);
    for (const f of ["latitude", "longitude"]) {
      if (f in ev.changes) {
        assert.ok(countDecimals(ev.changes[f].to) <= 3, `${table}.${f}.to debe tener <=3 decimales`);
        assert.ok(countDecimals(ev.changes[f].from) <= 3, `${table}.${f}.from debe tener <=3 decimales`);
      }
    }
  }
});

test("B3 history: edificios (damaged_reports) NO se redondean (coord exacta)", () => {
  const dBefore = { id: "d1", place_name: "Puente", severity: "HIGH", latitude: 10.123456, longitude: -66.987654, status: "OPEN", created_at: "t" };
  const ev = projectHistoryEvent({ action: "CREATE", occurred_at: "t", source: "s", before: null, after: dBefore }, "damaged_reports");
  assert.equal(ev.changes.latitude.to, 10.123456);
  assert.equal(ev.changes.longitude.to, -66.987654);
});

test("projectHistory mapea una lista de eventos preservando orden", () => {
  const evs = projectHistory(
    [
      { action: "CREATE", occurred_at: "t1", source: "s", before: null, after: before },
      { action: "UPDATE", occurred_at: "t2", source: "s", before, after: { ...before, status: "RESOLVED" } },
    ],
    "help_requests"
  );
  assert.equal(evs.length, 2);
  assert.equal(evs[0].action, "CREATE");
  assert.equal(evs[1].changes.status.to, "RESOLVED");
});
