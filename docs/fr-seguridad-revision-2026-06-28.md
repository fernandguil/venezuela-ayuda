# Revisión de seguridad FR-API en venezuela-ayuda — 2026-06-28

> **ESTADO: SOLO DOCUMENTACIÓN. No se aplica ningún cambio en este repo.**
> Por decisión del equipo (conversación HUB del 2026-06-28 11:30), **no se
> añadirá nada** a la integración FR de venezuela-ayuda hasta confirmarlo con
> el equipo de HUB. Este archivo deja constancia de lo identificado para esa
> conversación. Los fixes equivalentes **ya se aplicaron en reportavnzla**
> (repo aparte); aquí quedan pendientes a propósito.

## Contexto

Auditoría adversarial del FR-API (53 hallazgos, 52 confirmados) — informe
completo en el equipo de FR-API (`docs/FR-API-AUDITORIA-ROBUSTEZ-2026-06-28.md`
del proyecto terremoto-facial). Abajo, solo lo que toca a **venezuela-ayuda**.

## Hallazgos identificados (pendientes de decisión HUB)

1. **`/api/fr/check-duplicate` es público y reenvía la respuesta del FR-API tal
   cual** (`new NextResponse(await r.text())`). Lo usa el formulario de alta sin
   sesión. Hoy funciona como un **oráculo de reverse-lookup facial**: subir una
   foto cualquiera y enumerar personas del índice (nombre, ubicación, foto).
   - *Mitigación ya hecha aguas arriba:* el FR-API **ya no devuelve
     `contact_phone`** (se cortó en la fuente, desplegado 2026-06-28). Así que
     el teléfono ya no se filtra por esta vía aunque no se toque este repo.
   - *Pendiente (decisión HUB):* ¿se mantiene público mostrando fotos
     candidatas (UX "¿es la misma persona?") o se recorta a `{sí/no, conteo}`
     y se exige sesión para ver candidatos? En reportavnzla se decidió
     **mantener fotos candidatas** (datos ya públicos en el sitio de reportes).

2. **`/api/fr/duplicates`, `/api/fr/reconcile` sin sesión** → vuelcan datos de
   personas cross-source. (En reportavnzla se cerraron tras token admin.)
   *Pendiente:* definir si en va se gatean con `getAdminSession` (que ya existe
   para `/api/fr/search`) o equivalente.

3. **`/api/fr/search`** ya exige `getAdminSession` (correcto) — sin acción.

4. **Fail-open silencioso**: el `catch` y el reenvío no-2xx de `check-duplicate`
   no loguean (a diferencia de `frIndexPerson` en `src/lib/fr.ts`, que sí avisa).
   Dificulta diagnosticar 401/errores (fue la causa histórica del "0.35").
   *Pendiente:* `console.warn` en no-2xx + normalizar la respuesta al cliente.

5. **Sin tope de tamaño/timeout en los proxies** antes de reenviar al FR-API.
   Mitigado parcialmente: Vercel limita el body (~4.5 MB) y el FR-API ya valida
   tamaño/dimensiones (25 MP) y descarga (10 MB) aguas arriba.

## Qué NO está en riesgo (verificado)

- La **API key vive solo server-side** (proxies); nunca llega al navegador. OK.
- El FR-API ya aplica: SSRF (`is_safe_url`), tope de imagen (25 MP) y de
  descarga (10 MB), rate-limit por key, y **ya no emite teléfono**.

## Decisión

**Hold.** No se modifica la integración FR de venezuela-ayuda hasta confirmación
con el equipo de HUB (conv. 2026-06-28 11:30). Este documento es la referencia
para esa conversación.
