# RBAC — Control de Acceso Basado en Roles

Venezuela Ayuda usa un modelo **permisos atómicos → roles → usuarios** introducido en la migración `0029`.

## Conceptos

| Concepto | Tabla | Descripción |
|---|---|---|
| Permiso | `permissions` | Capacidad nombrada y atómica (p.ej. `admin.access`) |
| Rol | `roles` | Agrupación de permisos con un nombre descriptivo |
| Asignación rol↔permiso | `role_permissions` | Qué permisos tiene cada rol |
| Asignación usuario↔rol | `user_roles` | Qué roles tiene cada usuario (por email) |

## Permisos disponibles

| Nombre | Descripción |
|---|---|
| `admin.access` | Acceder al panel `/admin` |
| `admin.super` | Gestionar admins y claves de API de partners |
| `modupe.review` | Revisar y resolver candidatos de deduplicación |
| `center.manage` | Crear, editar y verificar centros de acopio |
| `partner.manage` | Emitir y revocar claves de API de partners |

## Roles predefinidos

| Rol | Permisos |
|---|---|
| `admin` | `admin.access`, `center.manage` |
| `super_admin` | Todos los anteriores + `admin.super`, `partner.manage`, `modupe.review` |
| `reviewer` | `admin.access`, `modupe.review` |

## Usar la librería RBAC

```typescript
import { hasPermission, requirePermission, getSession } from "@/lib/rbac";
import type { Permission } from "@/lib/rbac";

// En una Server Action o route handler:
const email = await requirePermission("admin.super");
// → lanza "unauthenticated" | "forbidden" si el usuario no cumple

// Para páginas que necesitan ramificar por múltiples permisos:
const session = await getSession();
if (!session) redirect("/admin/login");
const canManagePartners = session.permissions.includes("partner.manage");
```

## Crear un nuevo permiso

1. Añadir fila a la tabla `permissions` (o en una nueva migración si es permanente).
2. Asignarlo al rol correspondiente en `role_permissions`.
3. Añadir el nombre al tipo `Permission` en `src/lib/rbac.ts`.

```sql
-- Ejemplo: nuevo permiso para aprobar señales de hospitales
insert into permissions (name, description)
  values ('signal.approve', 'Promover señales de suministro a estado confirmado');

insert into role_permissions (role_id, permission_id)
  select r.id, p.id
  from roles r, permissions p
  where r.name = 'super_admin' and p.name = 'signal.approve';
```

## Asignar un rol a un usuario

```sql
insert into user_roles (email, role_id, granted_by)
  select 'usuario@ejemplo.com', id, 'admin@ejemplo.com'
  from roles where name = 'reviewer';
```

O desde el panel admin en `/admin/roles` (super-admin únicamente).

## Migración desde admin_emails

La migración `0029` copia automáticamente todas las entradas de `admin_emails` a `user_roles`:

- `is_super_admin = true` → rol `super_admin`
- `is_super_admin = false` → rol `admin`

La tabla `admin_emails` permanece activa mientras las rutas se migran progresivamente a la librería RBAC.

## Implementación interna

La función SQL `user_permissions(email)` ejecuta una sola consulta que atraviesa `user_roles → roles → role_permissions → permissions` y devuelve todos los permisos distintos del usuario. La librería TypeScript llama a esta función vía `.rpc("user_permissions", ...)` usando la clave de servicio.
