-- 0020 · P0: saca verified_by de public_damaged_reports (fuga de PII del admin)
--
-- HALLAZGO (certificado contra DB en vivo): la vista public_damaged_reports
-- incluía la columna `verified_by` (el EMAIL del admin que verificó el reporte) y
-- tiene `grant select to anon`. Aunque el código (src/lib/reports.mjs) ya NO la
-- pide, cualquiera con el anon key (público, viaja en el frontend) le pega directo
-- a PostgREST y lee el email:
--   GET /rest/v1/public_damaged_reports?select=verified_by
-- Es una fuga de dato interno/PII a anónimos. Se cierra EN LA FUENTE: la vista deja
-- de exponer la columna; PostgREST ya no puede seleccionarla.
--
-- NO-DESTRUCTIVO: solo recrea una VISTA. No toca ninguna fila de damaged_reports —
-- verified_by sigue intacto en la tabla base (la lee el admin con el service key).
-- Se conserva verified_at y TODO lo demás (filtro hidden = false, columnas, orden).
--
-- create or replace view NO permite quitar columnas en Postgres → drop + create.
drop view if exists public_damaged_reports;

create view public_damaged_reports as
  select id, place_name, description, severity, city, latitude, longitude,
         photo_url, status, created_at, verified_at, source, source_url,
         risk_level, risk_priority
  from damaged_reports where hidden = false;

grant select on public_damaged_reports to anon, authenticated;

insert into applied_migrations (version) values ('0020') on conflict do nothing;
