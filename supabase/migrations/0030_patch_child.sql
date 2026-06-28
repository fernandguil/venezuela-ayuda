-- 0030 · patch_child: editar un niño no acompañado + cadena de custodia (API)
--
-- El PATCH /api/v1/reports/{id} de un `unaccompanied_child` NO puede ir por el RPC
-- genérico patch_report: ese hace un UPDATE plano de UNA tabla. Editar un niño
-- necesita, además del UPDATE de unaccompanied_children, materializar el cambio de
-- paradero en la cadena de custodia (child_custody_events, append-only) y refrescar
-- last_custody_at — igual que el panel admin (addChildCustodyEvent) y que el trigger
-- de siembra (seed_child_custody, 0023).
--
-- Decisión de diseño: `status` es un campo plano más del patch. Cuando el patch
-- CAMBIA status, se auto-deriva un evento de custodia del nuevo estado del niño
-- (mismos campos que seed_child_custody) y se bumpea last_custody_at. Si el status
-- no cambia (o no viene en el patch), solo se aplican los campos y NO se toca la
-- cadena ni last_custody_at.
--
-- Atómico y auditado como los demás RPC: UPDATE + (insert custodia) + audit_log en
-- la misma transacción. Firma idéntica a patch_report pero SIN p_table (la tabla es
-- fija: unaccompanied_children). Solo service_role lo ejecuta.

create or replace function patch_child(
  p_id          uuid,
  p_patch       jsonb,
  p_partner     uuid,
  p_source      text,
  p_request_id  text,
  p_ip          text,
  p_user_agent  text
) returns jsonb
language plpgsql
as $fn$
declare
  v_before jsonb;
  v_after  jsonb;
  v_set    text;
begin
  -- Snapshot + lock (FOR UPDATE) para no carrear con otro update.
  select to_jsonb(t) into v_before
    from unaccompanied_children as t
    where t.id = p_id
    for update;
  if v_before is null then
    return null; -- no existe → el caller responde 404
  end if;

  -- Aplica los campos del patch (UPDATE dinámico, mismo patrón que patch_report:
  -- jsonb_populate_record castea cada llave a su columna; %I/quote_ident evita
  -- inyección). El caller (patch.mjs) ya garantizó patch no vacío y campos válidos.
  select string_agg(format('%I = r.%I', k.key, k.key), ', ')
    into v_set
    from jsonb_object_keys(p_patch) as k(key);

  if v_set is null then
    v_after := v_before; -- patch vacío (defensa; el caller ya lo evita)
  else
    execute format(
      'update unaccompanied_children as t set %1$s '
      || 'from jsonb_populate_record(null::unaccompanied_children, $1) as r '
      || 'where t.id = $2 returning to_jsonb(t)',
      v_set
    ) into v_after using p_patch, p_id;
  end if;

  -- Cambio de paradero: el patch trae `status` Y difiere del actual → materializa
  -- un evento de custodia derivado del NUEVO estado (igual que seed_child_custody)
  -- y refresca last_custody_at. recorded_by/source = el socio (de la API key).
  if (p_patch ? 'status')
     and (v_before->>'status') is distinct from (v_after->>'status') then
    insert into child_custody_events
      (child_id, event_date, facility_name, status, note, source, recorded_by)
    values
      (p_id,
       (v_after->>'last_seen_at')::date,
       coalesce(v_after->>'hospital', v_after->>'last_seen_place'),
       (v_after->>'status')::child_status,
       'Actualización de estado (API)',
       p_source,
       p_source);

    update unaccompanied_children as t
      set last_custody_at = now()
      where t.id = p_id
      returning to_jsonb(t) into v_after;
  end if;

  insert into audit_log (partner_id, source, action, resource_table, resource_id, external_id, before, after, request_id, ip, user_agent)
    values (p_partner, p_source, 'UPDATE', 'unaccompanied_children', p_id, v_after->>'external_id', v_before, v_after, p_request_id, p_ip, p_user_agent);

  return v_after;
end;
$fn$;

-- Solo server-side con service key (igual que ingest/patch/delete_report).
revoke execute on function patch_child(uuid, jsonb, uuid, text, text, text, text) from public;
grant  execute on function patch_child(uuid, jsonb, uuid, text, text, text, text) to service_role;

insert into applied_migrations (version) values ('0030') on conflict do nothing;
