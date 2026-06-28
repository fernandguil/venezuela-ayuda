<!-- PR pequeño y enfocado = revisión rápida. Un PR = un cambio lógico. -->

## Qué hace y por qué

<!-- 1-3 frases. Si hay issue, enlázalo: "Closes #123". -->

## Tipo de cambio

- [ ] `feat` — funcionalidad nueva
- [ ] `fix` — corrección de bug
- [ ] `docs` / `chore` / `refactor`
- [ ] Cambio de **base de datos** (incluye migración) ⚠️

## Destino

- [ ] Este PR va contra **`staging`** (no contra `main`).
- [ ] Si va contra `main`, es una **promoción `staging → main`** (solo maintainers).

## Checklist

- [ ] En local pasan `npm run lint`, `npm run build` y `node --test`.
- [ ] **Si toca frontend (UI/componentes):** adjunto un **GIF** del feature
  funcionando (recomendado). Con Claude Code: `/verify` lo graba por ti.
- [ ] El PR es pequeño y enfocado (un solo cambio lógico).
- [ ] No expongo PII (teléfonos/contactos) en logs ni en endpoints/vistas públicas.
- [ ] No subo secretos (`.env*`, keys, tokens).
- [ ] Actualicé docs/ADR si el cambio lo amerita.

## Si toca la base de datos ⚠️

> Recordatorio (no sustituye al CI ni a la revisión del owner de `db`):

- [ ] La migración usa **nombre por timestamp** (`YYYYMMDDHHMM_descripcion.sql`).
- [ ] Es **idempotente** (`if not exists`, `on conflict do nothing`) y no deja el esquema roto si corre sola.
- [ ] Cambios destructivos: uso **expand → migrate → contract** (no borro en la misma migración que añado).
- [ ] Probado contra la **DB de staging** antes de promover a `main`.

## Cómo lo probaste

<!-- Pasos, capturas, o comando. "Compila" no es "funciona". -->
