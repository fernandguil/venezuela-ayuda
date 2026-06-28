# Revisión de seguridad FR-API en venezuela-ayuda — 2026-06-28

> **ESTADO: SOLO DOCUMENTACIÓN. No se aplica ningún cambio de código en este repo.**
> Por decisión del equipo (conversación HUB del 2026-06-28 11:30), **no se
> añadirá nada** a la integración FR de venezuela-ayuda hasta confirmarlo con
> el equipo de HUB. Este archivo deja constancia de lo abordado/identificado.

## Origen

Esta tabla recoge **la revisión de `8vius` en el PR #28**
([PR #28](https://github.com/mawmawmaw/venezuela-ayuda/pull/28), 10 puntos +
limpieza) y la cruza con la **auditoría adversarial del FR-API** del 2026-06-28
(53 hallazgos). Para cada punto se anota el **estado actual**:
- ✅ **Mitigado aguas arriba** = ya resuelto en el FR-API (repo terremoto-facial, desplegado 2026-06-28).
- 🟦 **Hecho en reportavnzla** = fix equivalente ya aplicado en el otro consumidor.
- ⏸️ **HOLD va** = pendiente en ESTE repo, a la espera de confirmación HUB.

## 🔴 Bloqueantes (seguridad / privacidad)

**1. `check-duplicate` público expone PII de personas registradas** — `src/app/api/fr/check-duplicate/route.ts:39`
Reenvía el cuerpo del FR-API tal cual; `CheckinForm` renderiza `person_name`,
`image_url`, `last_seen_location`, `source` → enumeración de la base subiendo
rostros arbitrarios. (Contradice CLAUDE.md *"Never loosen redaction on public API responses."*)
- ✅ El FR-API **ya no devuelve `contact_phone`** (cortado en la fuente) → el teléfono ya no se filtra por esta vía aunque no se toque este repo.
- 🟦 En reportavnzla: `check-duplicate`/`search` siguen públicos con fotos candidatas (datos ya públicos en el sitio de reportes); `index`/`reconcile`/`duplicates` cerrados tras token admin.
- ⏸️ **HOLD va:** definir con HUB si se redacta a `{possible_duplicate, conteo}` o se exige sesión.

**2. Rutas de admin verifican `if (!session)` pero la función es solo super-admin** — `search/route.ts:11`, `duplicates:11`, `reconcile:11`
Un admin no-super de la allowlist puede `curl` esas rutas. → Añadir `if (!session.isSuper) return 403`.
- ⏸️ **HOLD va.**

**3. Se indexa TODO check-in con foto, incluidos los SAFE** — `src/app/actions.ts:139`
Quien se marca SAFE con selfie sube su rostro al índice compartido. → Indexar solo si `status === "LOOKING_FOR_SOMEONE"`.
- ⏸️ **HOLD va** (decisión de privacidad para HUB).

## 🟠 Correctitud / comportamiento

**4. Una `FR_API_KEY` mala indexa en silencio; el log prometido nunca dispara** — `src/lib/fr.ts:41`
No se revisa `res.ok` (fetch no lanza en 4xx/5xx). → `if (!res.ok) console.warn(...)`.
- ⏸️ **HOLD va.** (El FR-API ya loguea los 401 server-side, pero el cliente sigue ciego.)

**5. `frIndexPerson` se hace `await` y bloquea el redirect hasta 6s** — `src/app/actions.ts:140`
La fila ya quedó guardada; debería ser fire-and-forget. → Quitar el `await`.
- ⏸️ **HOLD va.**

**6. El chequeo de duplicados se omite si la foto se elige antes de marcar "buscando a alguien"** — `src/components/forms/CheckinForm.tsx:186`
`onPhoto={isMissing ? onPhoto : undefined}` + la preview ya puesta no re-dispara `onPick`. → Re-disparar al cambiar a LOOKING_FOR_SOMEONE.
- ⏸️ **HOLD va.**

**7. `duplicates` interpola `min_score`/`limit` sin codificar → inyección de `source`** — `src/app/api/fr/duplicates/route.ts:21`
`?min_score=0.6%26source=otherbase` sobreescribe el `source` del servidor. → `URLSearchParams`.
- 🟦 **Hecho en reportavnzla** (su `duplicates` ya usa `URLSearchParams`). ⏸️ **HOLD va.**

## 🟡 Robustez / DoS

**8. Sin tope de tamaño en el cuerpo de `check-duplicate` público** — `src/app/api/fr/check-duplicate/route.ts:21`
`req.json()` + regex base64 sin límite + `Buffer.from` en ruta sin auth = vector de memoria.
- ✅ **Mitigado aguas arriba:** el FR-API ahora topa imagen (25 MP) y descarga/base64 (10 MB). ⏸️ Tope en el proxy va: **HOLD** (defensa en profundidad).

**9. Rutas de admin del FR sin rate limiting pese a consumir cuota pagada** — `search/route.ts:11` (y `duplicates`, `reconcile`)
→ `rateLimit(clientKey(...))`.
- 🟦 En reportavnzla se añadió rate-limit a esas rutas. ⏸️ **HOLD va.** (El FR-API ya aplica rate-limit por key, pero no por IP/usuario aquí.)

**10. `check-duplicate` fetch sin AbortController/debounce → candidatos obsoletos** — `src/components/forms/CheckinForm.tsx:47`
Elegir foto A y luego B puede mostrar coincidencias de A. → Abortar la petición previa.
- ⏸️ **HOLD va** (UI).

## 🧹 Limpieza (no bloqueante, del PR #28)
- Extraer helper `frProxy()` + guard `requireAdminFr()` en `src/lib/fr.ts` (evita repetir las brechas 2/9 por ruta). ⏸️ HOLD.
- `pct()` duplicado en `CheckinForm.tsx:23` y `FaceRecognition.tsx`. ⏸️ HOLD.
- `FR_SOURCE` duplica `VA_SOURCE`. ⏸️ HOLD.
- Banner de `frCands` persiste tras cambiar a no-missing (`CheckinForm.tsx:193`). ⏸️ HOLD.

## Lo que ya está BIEN (verificado, no tocar)
- API key **solo server-side** (proxies); nunca llega al navegador.
- FR-API aguas arriba: SSRF (`is_safe_url`), tope imagen 25 MP + descarga 10 MB, rate-limit por key, **ya no emite `contact_phone`**.
- `source` se fija en el servidor para las escrituras.

## Decisión
**Hold.** No se modifica la integración FR de venezuela-ayuda hasta confirmación
con el equipo de HUB (conv. 2026-06-28 11:30). Este documento es la referencia
para esa conversación: enumera lo identificado en el PR #28 y qué ya quedó
mitigado aguas arriba (FR-API) o en reportavnzla.
