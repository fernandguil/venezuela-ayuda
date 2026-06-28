---
date: 2026-06-28
topic: api-security
branch: fix/api-pii-read-leaks
regression_test: scripts/audit.test.mjs
db_verify: |
  # Confirma que verified_by ya NO sale por PostgREST (debe dar 400/error de columna):
  curl -sS "$SUPABASE_URL/rest/v1/public_damaged_reports?select=verified_by&limit=1" \
    -H "apikey: $SUPABASE_ANON_KEY" -H "Authorization: Bearer $SUPABASE_ANON_KEY"
  # Sanity: la vista sigue sirviendo el resto de columnas (debe dar 200 con filas):
  curl -sS "$SUPABASE_URL/rest/v1/public_damaged_reports?select=id,verified_at,status&limit=1" \
    -H "apikey: $SUPABASE_ANON_KEY" -H "Authorization: Bearer $SUPABASE_ANON_KEY"
---

# Revisión de seguridad del API de ingesta (4 reviewers CE)

Revisión adversarial del API público de ingesta/lectura. Hallazgos agrupados por
severidad. Cada uno: archivo:línea · qué es · impacto · estado.

Estados: **ESTE PR** = lo cierra `fix/api-pii-read-leaks`. **PENDIENTE-DECISIÓN** =
toca diseño, requiere acuerdo antes de tocar. **PENDIENTE** = aceptado, sin owner aún.

---

## P0 — Crítico

### 1. `verified_by` legible por anon vía PostgREST — ESTE PR
- **Dónde**: `supabase/migrations/0012_damaged_risk.sql:15-19` (definición vigente de la vista).
- **Qué**: la vista `public_damaged_reports` incluía la columna `verified_by` (el
  EMAIL del admin que verificó el reporte) y tiene `grant select to anon`. El código
  (`src/lib/reports.mjs`) ya no la pedía, pero cualquiera con el anon key le pega
  directo a PostgREST: `GET /rest/v1/public_damaged_reports?select=verified_by`.
- **Impacto**: fuga de PII interna (correo de admins) a cualquier anónimo.
- **Fix**: migración `0020_drop_verified_by_from_public_view.sql` recrea la vista
  SIN `verified_by` (drop+create; no-destructivo, solo vista, conserva `verified_at`).
  Defensa en profundidad: `verified_by` agregado a `FORBIDDEN_FIELDS` en `audit.mjs`
  para que tampoco salga por `/history`.
- **Verificación**: ver `db_verify` en el frontmatter + `scripts/audit.test.mjs`.

### 2. Upsert `(source,external_id)` reclasifica missing_person→checkin en silencio — PENDIENTE-DECISIÓN
- **Dónde**: `src/lib/ingest.mjs` + conflict target en `0015_api_partners.sql`.
- **Qué**: missing_person y checkin comparten la tabla `checkins` y se separan por
  `status`. El upsert por `(source, external_id)` no incluye el status en la clave de
  conflicto, así que un re-ingest con el mismo external_id puede cruzar la frontera de
  status (un desaparecido pasa a checkin "a salvo", o viceversa) sin señal.
- **Impacto**: integridad — un buscado puede "desaparecer" de la lista de búsqueda.
- **Estado**: PENDIENTE-DECISIÓN — toca semántica del conflict target.

---

## P1 — Alto

### 3. PATCH cross-cliente edita campos derivados/ajenos — PENDIENTE-DECISIÓN
- **Dónde**: `src/lib/patch.mjs` (SPECS de campos parcheables).
- **Qué**: el PATCH cross-cliente permite editar `risk_level`/`risk_priority`
  (derivados server-side del cuestionario) y `found_at` de reportes ajenos.
- **Impacto**: tampering de seguridad física — falsear el semáforo de riesgo
  estructural, o marcar `found_at` para desaparecer buscados de la búsqueda activa.
- **Estado**: PENDIENTE-DECISIÓN — toca el diseño del PATCH cross-cliente.

### 4. `/history` no valida `resource_table` ∈ 4 públicas — ESTE PR
- **Dónde**: `src/app/api/v1/reports/[id]/history/route.ts:59-60` (antes).
- **Qué**: proyectaba todo el trail con la tabla de `rows[0].resource_table`. Si el
  trail mezcla tablas, o el id pertenece a una tabla no pública (p.ej.
  `collection_centers`), proyecta con la whitelist equivocada.
- **Impacto**: proyección incorrecta; riesgo de exponer campos de tablas no públicas.
- **Fix**: `projectHistoryEvent(event)` deriva la tabla POR EVENTO de
  `event.resource_table`; si no está en `VIEW_FOR_TABLE` (las 4 públicas) descarta el
  evento. `projectHistory(events)` filtra los `null`. El caller usa `projectHistory(rows)`.

### 5. `x-forwarded-for` tomado del primer hop (spoofeable) — PENDIENTE
- **Dónde**: `src/lib/rateLimit.ts`, `src/lib/partnerAuth.ts`.
- **Qué**: se confía en el primer valor de `x-forwarded-for`, que el cliente controla.
- **Impacto**: evade el rate-limit (rotando la IP declarada) y falsea `audit_log.ip`
  (corrompe el valor forense).
- **Estado**: PENDIENTE — fijar el número de proxies de confianza / usar el hop correcto.

### 6. RPC `ingest_reports`/`patch_report` aplican cualquier columna (sin whitelist plpgsql) — PENDIENTE
- **Dónde**: RPC en migraciones + `src/app/.../admin/actions.ts` (ya las invoca con
  `hidden`/`verified_by` crudos).
- **Qué**: las funciones plpgsql aplican cualquier columna existente del payload sin
  whitelist; no hay defensa en la capa de DB si la app manda campos internos.
- **Impacto**: defensa en profundidad ausente — un bug en la app escribe campos
  internos sin barrera.
- **Estado**: PENDIENTE — agregar whitelist de columnas en las RPC.

---

## P2 — Medio

- **`photo_url`/`source_url` sin allowlist de protocolo** — `src/lib/ingest.mjs` (clean):
  permite `javascript:`/`data:` → stored-XSS en consumidores que rendericen el URL. PENDIENTE.
- **Oráculo de filas ocultas vía PATCH** — `src/app/api/v1/reports/[id]/route.ts`: el
  PATCH distingue "no existe" de "oculto", filtrando la existencia de reportes ocultos. PENDIENTE.
- **`available:null`→true en PATCH** — `src/lib/patch.mjs`: un null se interpreta como
  disponible; debe preservar o rechazar, no asumir true. PENDIENTE.
- **POST batch éxito-parcial responde 200** — `route.ts:~252`: un lote con fallos
  parciales devuelve 200; el cliente no distingue éxito total de parcial. PENDIENTE.
- **zip de ids asume array alineado** — `route.ts:~241`: empareja ids con items por
  índice asumiendo alineación; si la RPC reordena/omite, asigna ids cruzados. PENDIENTE.
- **GET/PATCH `[id]` tira 503 si falla 1 de 4 vistas** — `[id]/route.ts`: resuelve el id
  probando 4 tablas; un fallo en una tumba toda la respuesta. PENDIENTE.
- **rate-limit Map sin tope duro** — `rateLimit.ts`: el Map en memoria crece sin
  límite máximo → presión de memoria / DoS por cardinalidad de claves. PENDIENTE.
- **foto huérfana si falla el insert** — `admin/actions.ts`: sube la foto antes del
  insert; si el insert falla, la foto queda huérfana en storage. PENDIENTE.
- **OpenAI client por request** — `classify/route.ts`: instancia el cliente en cada
  request en lugar de reusarlo. PENDIENTE.
- **cursor `since` puede saltar filas** — `reports.mjs`: con `created_at` igual y uuid
  no monotónico, el cursor `created_at|id` puede saltar/repetir en el límite del lote. PENDIENTE.
- **content-length falsificable** (#101, YA-CONOCIDO): el límite por content-length se
  puede declarar falso; ya rastreado en el issue #101. PENDIENTE.

---

## Resumen de cambios de ESTE PR

| Archivo | Cambio |
|---|---|
| `supabase/migrations/0020_drop_verified_by_from_public_view.sql` | Nueva: recrea la vista sin `verified_by` (no-destructivo) |
| `src/lib/audit.mjs` | `verified_by`/`hidden`/`verified` a FORBIDDEN; tabla por evento (`resource_table`); filtro explícito de FORBIDDEN |
| `src/app/api/v1/reports/[id]/history/route.ts` | `projectHistory(rows)` sin tabla del primer row |
| `scripts/audit.test.mjs` | Tests: verified_by/hidden/manage_token nunca salen; tabla no pública se descarta; trail multi-tabla por evento |
