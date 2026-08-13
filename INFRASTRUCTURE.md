# Infrastructure & Deployment Standard

> **Qué es este documento**
> Define la arquitectura, convenciones y reglas obligatorias para construir, configurar y desplegar este proyecto.
>
> **Cómo se usa**
> Se copia tal cual a cualquier repositorio. Únicamente se completa la **§0 (Instanciación)**. El resto es invariante: si algo no aplica, se registra una desviación según la **§14** — no se edita la regla.
>
> **Los agentes de IA deben leer este archivo antes de modificar** infraestructura, contenedores, orquestación, CI/CD, configuración, secretos o procesos de deployment.

**Versión del estándar:** 2.1.0 · **Última revisión:** rellenar al adoptar

---

# 0. Instanciación del proyecto

Única sección editable por proyecto. Debe mantenerse sincronizada con `infra.project.yml` (Anexo A), que es la fuente legible por máquina.

| Clave | Valor | Notas |
|---|---|---|
| `<ORG>` | | Organización / owner del repositorio |
| `<PROJECT>` | | Slug en `kebab-case`, único dentro de la organización |
| `<PROJECT_SNAKE>` | | Mismo nombre en `snake_case` — base del nombre del secret |
| `<TRACK>` | `app` / `cms` | Vía. Ver §2 |
| `<PROFILE>` | `A` / `B` / `C` | Topología. Ver §3 |
| `<REGISTRY>` | `ghcr.io` | Alternativas: Docker Hub, ECR, GAR, ACR, Harbor |
| `<IMAGE_BASE>` | `<REGISTRY>/<ORG>/<PROJECT>` | Prefijo de todas las imágenes |
| `<RUNTIME_MANAGER>` | Portainer | Ver §8 para adaptadores admitidos |
| `<SECRET_NAME>` | `<PROJECT_SNAKE>_env` | Ver §6 |
| `<HEALTH_URL>` | | Verificable desde CI |
| `<RUNTIME_LANG>` | | Determina el adaptador del Anexo B |
| `<UPSTREAM_IMAGE>` | | Solo vía CMS: imagen base y versión fijada |
| `<SERVICES>` | | Servicios con estado o dependencias del stack |

**INF-001 (MUST)** — Ningún otro archivo del repositorio redefine estos valores. Son la única fuente de verdad.

**INF-002 (MUST)** — Los nombres derivados (`<SECRET_NAME>`, `<IMAGE_BASE>`) se calculan a partir de `<PROJECT>`; no se eligen de forma independiente.

**INF-003 (MUST)** — Un proyecto declara exactamente una vía y exactamente un perfil.

---

# 1. Alcance y niveles normativos

Palabras clave según RFC 2119:

| Nivel | Significado |
|---|---|
| **MUST** | Obligatorio. Su incumplimiento invalida el deployment y bloquea el merge. |
| **SHOULD** | Recomendado. Puede omitirse con justificación registrada (§14). |
| **MAY** | Opcional. Decisión libre del proyecto. |

Cada regla tiene un identificador estable para poder citarla en revisiones de PR y validaciones automáticas.

```text
INF-xxx   Reglas universales — aplican a toda vía y todo perfil
APP-xxx   Reglas adicionales de la vía Aplicación
CMS-xxx   Reglas adicionales o sustitutivas de la vía CMS
```

Rangos dentro de `INF`:

```text
INF-0xx  Instanciación        INF-5xx  Salud, rollback, persistencia
INF-1xx  Versionado           INF-6xx  Seguridad
INF-2xx  Configuración        INF-7xx  Repositorio
INF-3xx  Pipeline             INF-8xx  Agentes de IA
INF-4xx  Deploy y runtime     INF-9xx  Desviaciones
```

**Alcance.** Cubre el camino desde el commit hasta producción saludable. No prescribe framework, lenguaje, base de datos ni diseño interno de la aplicación.

---

# 2. Las dos vías

La **vía** describe la naturaleza de lo que se despliega. Es la decisión que más reglas condiciona, y por eso se declara antes que el perfil.

## 2.1 Vía Aplicación (`app`)

Un sistema construido a medida. El repositorio contiene el código fuente, el pipeline lo compila, y la imagen resultante **es** el producto. Todo el comportamiento en producción proviene de una release.

## 2.2 Vía CMS (`cms`)

Un sitio operado sobre un gestor de contenido de terceros: WordPress, Ghost, Directus, Strapi, Payload, Drupal. El repositorio no contiene el producto completo — contiene la **personalización** (temas, plugins, configuración) sobre una imagen upstream. Y algo que la vía aplicación no tiene: **usuarios que modifican producción todos los días sin pasar por el pipeline**.

## 2.3 Qué cambia entre vías

| | **Vía Aplicación** | **Vía CMS** |
|---|---|---|
| Origen de la imagen | Construida desde el repositorio | Upstream fijada, opcionalmente extendida |
| Qué versiona la release | El código de la aplicación | Core + temas + plugins + configuración |
| Contenido | Parte del código o irrelevante | **Estado de producción, nunca versionado** |
| Canales de cambio | Uno: el pipeline | Dos: el pipeline y el panel de administración |
| Etapa de tests | Tests automatizados | Smoke tests (§13.6) |
| Migraciones | Propias, declaradas (§7.3) | Del core, ejecutadas tras el upgrade |
| Riesgo principal | Regresión de código | **Drift**: producción deja de parecerse al repositorio |
| Backup pre-deploy | Recomendado | **Obligatorio** |

**INF-004 (MUST)** — Las reglas `INF` aplican a ambas vías. Las reglas de vía añaden o sustituyen; cuando sustituyen, lo indican explícitamente.

## 2.4 Proyectos mixtos

Un sitio headless —CMS como backend de contenido más un frontend propio— es un proyecto de **vía CMS con un componente de vía aplicación**. Se declara `track: cms` con `headless: true` y se le aplican además `APP-100` y `APP-102` al frontend. Ver §13.7, que define el punto crítico: los dos canales de despliegue no se mezclan.

---

# 3. Perfiles de topología

El perfil describe dónde corre el stack. Es independiente de la vía.

| | **Perfil A** — Compose | **Perfil B** — Swarm | **Perfil C** — Multi-imagen |
|---|---|---|---|
| Topología | Host único | Cluster | A o B, varios artefactos |
| Unidad de deploy | Stack Compose | Stack Swarm | Stack + N imágenes |
| Réplicas | 1 por servicio | N por servicio | Según servicio |
| Zero-downtime | Best effort | `update_config` obligatorio | Según servicio |
| Almacenamiento de archivos | Volumen local admisible | **Object storage obligatorio** | Según servicio |

**INF-101 (MUST)** — En Perfil C, todas las imágenes de una release comparten el mismo tag `vX.Y.Z`. No se versionan componentes de forma independiente dentro del mismo repositorio.

**INF-102 (MUST)** — En Perfil B, ningún servicio replicado depende de archivos escritos en el filesystem local del contenedor. Esto afecta especialmente a la vía CMS (ver `CMS-112`).

---

# 4. Modelo de responsabilidades

El estándar define **roles**, no herramientas. Cada rol tiene implementación por defecto y alternativas admitidas.

| Rol | Responsabilidad | Por defecto | Alternativas |
|---|---|---|---|
| **SCM** | Código, tags, releases | GitHub | GitLab, Gitea |
| **CI/CD** | Tests, build, publicación, disparo del deploy, verificación | GitHub Actions | GitLab CI, Woodpecker |
| **Registry** | Imágenes inmutables | `<REGISTRY>` | Cualquiera con soporte OCI |
| **Runtime Manager** | Stacks, redes, volúmenes, secretos, aplicación del deploy | `<RUNTIME_MANAGER>` | §8 |
| **Config Store** | Custodia de la configuración de producción | Docker Secrets | Vault, SOPS + secret |
| **Aplicación / CMS** | Leer configuración, arrancar, exponer salud y versión | — | — |

**INF-301 (MUST)** — El CI no asume responsabilidades del Runtime Manager: no crea ni modifica secretos, volúmenes, redes ni configuración de runtime en el servidor.

**INF-302 (MUST)** — El Runtime Manager no compila ni construye imágenes.

**INF-303 (MUST)** — Lo desplegado no conoce a Portainer, al SCM ni al registry. Solo conoce el contrato de configuración (§6) y el de salud (§9). Esto es lo que hace el proyecto portable.

---

# 5. Versionado y artefactos

## 5.1 Semantic Versioning

**INF-100 (MUST)** — Las releases usan `vMAJOR.MINOR.PATCH`.

| Incremento | Vía Aplicación | Vía CMS |
|---|---|---|
| `PATCH` | Correcciones internas | Parche de core, plugin o tema sin cambio visible |
| `MINOR` | Funcionalidad compatible | Plugin nuevo, cambio de tema, funcionalidad nueva |
| `MAJOR` | Cambio incompatible | Upgrade de core con cambio de esquema, cambio de tema base |

**INF-103 (SHOULD)** — Los pre-releases usan `vX.Y.Z-rc.N` y se despliegan solo en staging, si el proyecto define ese canal.

## 5.2 Inmutabilidad

**INF-110 (MUST)** — Cada release genera imágenes etiquetadas exactamente con el tag de la release.

```text
Release v1.4.2  →  <IMAGE_BASE>:v1.4.2
```

**INF-111 (MUST)** — Prohibido `latest` en producción, y prohibido cualquier tag flotante que pueda cambiar de contenido (`:8`, `:stable`, `:alpine`). Esto incluye las imágenes upstream de la vía CMS.

```yaml
# ✗ prohibido
image: <IMAGE_BASE>:latest
image: wordpress:latest
image: wordpress:6-fpm

# ✓ requerido
image: <IMAGE_BASE>:v1.4.2
image: wordpress:6.8.1-fpm
```

**INF-112 (MUST)** — Una imagen publicada no se sobrescribe ni se re-publica. Si el contenido fue incorrecto, se emite una nueva versión.

**INF-113 (SHOULD)** — El registry tiene habilitada la inmutabilidad de tags a nivel de plataforma, para que INF-112 no dependa de la disciplina del equipo.

**INF-114 (MAY)** — El compose puede fijar además el digest:

```yaml
image: <IMAGE_BASE>:v1.4.2@sha256:<digest>
```

**INF-115 (SHOULD)** — Las imágenes se construyen para las arquitecturas realmente usadas en producción y desarrollo.

**INF-116 (SHOULD)** — El pipeline publica metadatos de procedencia y un SBOM junto a la imagen.

## 5.3 Rollback

**INF-120 (MUST)** — El rollback consiste en volver a fijar una versión previamente válida. Nunca se reconstruye una imagen antigua.

**INF-121 (MUST)** — El rollback debe ser posible sin acceso al pipeline: basta editar el tag en el stack y re-aplicarlo.

**INF-122 (MUST)** — Si una release incluye una migración de datos irreversible, se documenta en las notas de la release que el rollback de imagen **no** revierte el esquema, e indica el procedimiento. En vía CMS esto es la norma, no la excepción: ver `CMS-120`.

---

# 6. Configuración y secretos

## 6.1 Regla del secret único

**INF-200 (MUST)** — El proyecto usa **un solo secret de configuración**, no uno por variable.

```text
✗  database_password, jwt_secret, smtp_password, ...
✓  <SECRET_NAME>
```

Es intencional: simplifica la rotación, evita divergencia entre entornos y hace que agregar una variable no requiera tocar infraestructura.

**INF-201 (MUST)** — El nombre del secret es `<PROJECT_SNAKE>_env`, montado en:

```text
/run/secrets/<PROJECT_SNAKE>_env
```

**INF-202 (MUST)** — El secret se declara como externo. Debe existir previamente en el Runtime Manager.

```yaml
services:
  app:
    image: <IMAGE_BASE>:v1.4.2
    secrets:
      - <SECRET_NAME>

secrets:
  <SECRET_NAME>:
    external: true
```

```yaml
# ✗ prohibido en producción
secrets:
  <SECRET_NAME>:
    file: .env
```

**INF-203 (MUST)** — El secret se declara únicamente en los servicios que realmente lo consumen.

**INF-204 (MAY)** — Un proyecto puede definir un segundo secret exclusivamente para material que no es texto plano de configuración (claves privadas, certificados, keyfiles). No para variables.

## 6.2 Contenido y formato

**INF-210 (MUST)** — El secret contiene texto `KEY=VALUE`, equivalente conceptual a un `.env.production`, sin valores reales versionados jamás.

**INF-211 (MUST)** — Toda la configuración de los servicios del stack que la requieran proviene de este mismo mecanismo. No se escriben credenciales dentro del compose.

## 6.3 Precedencia y carga

**INF-220 (MUST)** — El orden de precedencia es fijo e idéntico en todos los entornos:

```text
1. Variables de entorno del proceso   (mayor prioridad)
2. /run/secrets/<SECRET_NAME>
3. .env                                (solo desarrollo)
4. Valores por defecto del código      (menor prioridad)
```

**INF-221 (MUST)** — La misma imagen funciona en desarrollo y en producción sin cambios de código. El único diferenciador es la presencia del archivo de secret.

```text
DESARROLLO                    PRODUCCIÓN
.env                          Runtime Manager
  │                             │
  ▼                             ▼
Aplicación                    Secret único
                                │
                                ▼
                              /run/secrets/<SECRET_NAME>
                                │
                                ▼
                              Aplicación
```

Adaptadores por lenguaje y por CMS: **Anexo B**.

**INF-222 (MUST)** — La configuración se valida al arrancar; el proceso falla de forma inmediata y explícita si falta una variable requerida.

**INF-223 (MUST)** — Nunca se escriben valores sensibles en logs, trazas ni respuestas de error.

## 6.4 `.env.example`

**INF-230 (MUST)** — El repositorio contiene `.env.example` con todas las variables requeridas, con valores vacíos o placeholders evidentes, nunca reales.

**INF-231 (MUST)** — Al introducir una variable nueva, en el mismo cambio se debe: agregar soporte en configuración, agregarla a `.env.example`, documentarla si no es evidente, asumir que producción la recibirá por el secret único, y **no** crear un secret nuevo.

**INF-232 (SHOULD)** — El CI verifica que `.env.example` cubra las variables declaradas como requeridas.

## 6.5 Secretos de CI

**INF-240 (MUST)** — Los secretos del CI cubren solo lo necesario para construir y desplegar. No son un espejo de la configuración de runtime.

```text
✓  REGISTRY_TOKEN, DEPLOY_WEBHOOK_URL, HEALTHCHECK_TOKEN
✗  DATABASE_PASSWORD, JWT_SECRET, claves de proveedores
```

**INF-241 (SHOULD)** — El secret de configuración se rota sin necesidad de una nueva release: se actualiza en el Runtime Manager y se reinicia el servicio.

---

# 7. Pipeline de release

## 7.1 Regla principal

**INF-300 (MUST)** — Producción es **release-driven**. Un push a la rama principal no despliega producción; el disparador es la creación de una release SemVer.

## 7.2 Etapas obligatorias

**INF-310 (MUST)** — Al crearse `vX.Y.Z`, el pipeline ejecuta en este orden:

| # | Etapa | Vía Aplicación | Vía CMS | Falla ⇒ aborta |
|---|---|---|---|---|
| 1 | Validar formato SemVer | ✓ | ✓ | ✓ |
| 2 | Verificar tag upstream fijado | — | ✓ | ✓ |
| 3 | Tests | automatizados | smoke (§13.6) | ✓ |
| 4 | Build | ✓ | si hay imagen propia | ✓ |
| 5 | Construir imagen(es) | ✓ | ✓ | ✓ |
| 6 | Etiquetar con el tag de la release | ✓ | ✓ | ✓ |
| 7 | Publicar en el registry | ✓ | ✓ | ✓ |
| 8 | **Backup verificado de datos y archivos** | recomendado | **obligatorio** | ✓ |
| 9 | Fijar el tag en `docker-compose.yml` | ✓ | ✓ | ✓ |
| 10 | Commit + push del compose | ✓ | ✓ | ✓ |
| 11 | Disparar el deploy (§8) | ✓ | ✓ | ✓ |
| 12 | Esperar a que termine | ✓ | ✓ | ✓ |
| 13 | Ejecutar migraciones | según §7.3 | `CMS-121` | ✓ |
| 14 | Verificar salud **y versión** (§9) | ✓ | ✓ | ✓ |
| 15 | Marcar el deployment como exitoso | ✓ | ✓ | — |

**INF-311 (MUST)** — El deploy se dispara **después** de que el compose actualizado esté disponible en el SCM. Nunca antes.

**INF-312 (MUST)** — El pipeline nunca reporta éxito si producción no quedó correctamente desplegada y verificada. Un job en verde con producción caída es una falla del estándar, no un caso aceptable.

**INF-313 (MUST)** — El pipeline es idempotente: re-ejecutarlo sobre el mismo tag no produce artefactos distintos ni estado inconsistente.

**INF-314 (SHOULD)** — Se usa control de concurrencia para impedir dos deploys simultáneos sobre el mismo entorno.

**INF-315 (SHOULD)** — El token del pipeline tiene el mínimo privilegio necesario, declarado por job.

## 7.3 Migraciones

**INF-320 (MUST)** — El proyecto declara explícitamente dónde se ejecutan las migraciones de esquema. Una sola opción, documentada en `infra.project.yml`:

| Estrategia | Cuándo conviene |
|---|---|
| Al arrancar el contenedor, antes de servir tráfico | Perfil A, réplica única |
| Job de migración dedicado previo al despliegue | Perfiles B y C |
| Paso explícito posterior al deploy | Vía CMS (`CMS-121`) |
| Manual, con aprobación | Migraciones destructivas o largas |

**INF-321 (MUST)** — Con más de una réplica, las migraciones no se ejecutan en el arranque de cada réplica.

**INF-322 (SHOULD)** — Las migraciones son compatibles hacia atrás dentro de una misma MAJOR, para que convivan brevemente ambas versiones durante el despliegue.

---

# 8. Deploy y runtime

## 8.1 Contrato del disparador

**INF-400 (MUST)** — El deploy se dispara mediante un mecanismo que cumpla este contrato:

1. es invocable desde el CI con una credencial;
2. hace que el runtime lea el stack versionado y aplique las imágenes fijadas;
3. permite al CI determinar si el cambio se aplicó.

| Adaptador | Disparo |
|---|---|
| **Portainer** (por defecto) | Webhook de actualización del stack |
| Compose vía SSH | `pull` + `up -d` remoto |
| Swarm | `docker stack deploy` remoto |
| GitOps (Argo CD, Flux) | Reconciliación desde el repositorio |

**INF-401 (MUST)** — Sea cual sea el adaptador, el estado deseado vive en el repositorio. La interfaz del Runtime Manager no es la fuente de verdad para las versiones de imagen.

## 8.2 Runtime Manager

**INF-410 (MUST)** — El Runtime Manager es responsable de stacks, servicios, secretos, redes, volúmenes y aplicación del deploy. El CI no reemplaza esta responsabilidad.

**INF-411 (MUST)** — `docker-compose.yml` está versionado y forma parte del código. Los tags que contiene representan lo desplegado o lo listo para desplegar.

**INF-412 (SHOULD)** — Todo cambio manual en la UI del runtime que afecte al stack se refleja después en el repositorio, o se revierte.

---

# 9. Salud, verificación y persistencia

## 9.1 Contrato de salud

**INF-500 (MUST)** — El servicio principal expone:

```http
GET /health  →  200  {"status":"ok"}
```

**INF-501 (SHOULD)** — Se distinguen liveness y readiness cuando hay dependencias de arranque:

| Endpoint | Significa |
|---|---|
| `GET /health` | El proceso está vivo |
| `GET /health/ready` | Dependencias listas; puede recibir tráfico |

**INF-502 (MUST)** — El servicio expone la versión efectivamente desplegada:

```http
GET /version  →  200  {"version":"v1.4.2"}
```

**INF-503 (MUST)** — La verificación post-deploy comprueba **salud y versión**. Un `200 OK` de la versión anterior es una falla de deployment, no un éxito. Es la única forma de detectar que el runtime no aplicó el cambio.

**INF-504 (MUST)** — La verificación define reintentos y timeout explícitos, y falla al agotarlos.

**INF-505 (SHOULD)** — Los servicios definen `healthcheck` a nivel de contenedor, para que el runtime también reaccione por su cuenta.

## 9.2 Persistencia

**INF-510 (MUST)** — Los servicios con estado usan volúmenes persistentes.

**INF-511 (MUST)** — Actualizar una imagen nunca destruye datos persistentes.

**INF-512 (MUST)** — Un deployment nunca elimina volúmenes de forma automática.

**INF-513 (SHOULD)** — El proyecto documenta qué volúmenes existen, qué contienen y cómo se respaldan.

---

# 10. Seguridad

**INF-600 (MUST)** — Ningún secreto se escribe en el repositorio: ni en el compose, ni en el código, ni en archivos versionados.

**INF-601 (MUST)** — `.env` está en `.gitignore` y nunca llega al repositorio.

**INF-602 (MUST)** — Las variables compiladas dentro de un artefacto de frontend son públicas por definición. Nunca contienen credenciales.

```text
✗  VITE_DATABASE_PASSWORD, NEXT_PUBLIC_API_KEY
✓  VITE_API_BASE_URL, VITE_APP_VERSION
```

**INF-603 (MUST)** — Las credenciales privadas permanecen del lado servidor.

**INF-604 (MUST)** — Los secretos no se pasan como build args ni quedan en capas de la imagen.

**INF-605 (SHOULD)** — Los contenedores corren como usuario no root.

**INF-606 (SHOULD)** — El pipeline escanea vulnerabilidades de la imagen; el umbral de bloqueo lo define el proyecto.

**INF-607 (SHOULD)** — Solo se publican los puertos necesarios; la comunicación entre servicios usa la red interna del stack.

---

# 11. Repositorio y documentación

**INF-700 (MUST)** — El repositorio contiene:

```text
INFRASTRUCTURE.md      este estándar
infra.project.yml      instanciación legible por máquina (Anexo A)
AGENTS.md              instrucciones para agentes (Anexo C)
README.md              arranque local y descripción
.env.example           contrato de configuración
.gitignore             incluye .env
docker-compose.yml     stack versionado
```

**INF-701 (SHOULD)** — `docs/DEPLOYMENT.md` documenta lo específico: estrategia de migraciones, volúmenes, procedimiento de rollback y contactos. En vía CMS documenta además el procedimiento de backup y restauración.

**INF-710 (MAY)** — La estructura de la aplicación es libre. Las convenciones de infraestructura no varían.

---

# 12. Vía Aplicación

Reglas adicionales cuando `track: app`.

**APP-100 (MUST)** — Existen tests automatizados y son una etapa bloqueante del pipeline. Un proyecto sin tests no puede declarar esta vía sin registrar una desviación.

**APP-101 (MUST)** — Las migraciones de esquema son propias del proyecto, versionadas junto al código, y su estrategia está declarada según `INF-320`.

**APP-102 (MUST)** — La imagen se construye enteramente desde el repositorio. Nada se descarga ni se instala en tiempo de arranque: si el contenedor necesita red para estar completo, la imagen no es inmutable.

**APP-103 (SHOULD)** — El build es reproducible: dependencias fijadas mediante lockfile versionado.

---

# 13. Vía CMS

Reglas adicionales o sustitutivas cuando `track: cms`.

La premisa que ordena toda esta sección: **el repositorio define cómo se ve y qué puede hacer el sitio; producción define qué contiene**. Confundir esas dos cosas es el origen de casi todos los incidentes en proyectos CMS.

## 13.1 La imagen

**CMS-100 (MUST)** — La imagen upstream se fija a una versión exacta en `<UPSTREAM_IMAGE>`, incluyendo el patch. Sustituye nada de `INF-111`: lo refuerza.

```text
✗  wordpress:latest    wordpress:6      ghost:5-alpine
✓  wordpress:6.8.1-php8.3-fpm           ghost:5.118.1
```

**CMS-101 (MUST)** — Si el proyecto tiene temas, plugins o configuración propia, se construye una imagen propia que los incluye:

```dockerfile
FROM wordpress:6.8.1-php8.3-fpm
COPY --chown=www-data:www-data wp-content/themes/<theme> /var/www/html/wp-content/themes/<theme>
COPY --chown=www-data:www-data wp-content/plugins/       /var/www/html/wp-content/plugins/
```

El código no se monta por bind mount ni se sincroniza por FTP/rsync en producción. Si el código llega al servidor por fuera de una imagen, se pierde la inmutabilidad y el rollback deja de funcionar.

**CMS-102 (MUST)** — El conjunto completo de core, plugins y temas está declarado en el repositorio mediante un manifiesto versionado (`composer.json`, `package.json`, o una lista explícita con versiones). Ese manifiesto es la fuente de verdad de qué extensiones existen.

**CMS-103 (MUST)** — Las actualizaciones automáticas del CMS están **deshabilitadas en producción**. Un core que se actualiza solo hace que la imagen deje de representar lo desplegado, y rompe simultáneamente `INF-110`, `INF-120` e `INF-503`.

```php
// wp-config.php
define('AUTOMATIC_UPDATER_DISABLED', true);
define('DISALLOW_FILE_MODS', true);   // también bloquea instalación desde el panel
```

**CMS-104 (MUST)** — El panel de administración **no es un canal de despliegue**. Instalar, actualizar o eliminar plugins y temas desde el panel de producción está prohibido: se hace en el repositorio y llega por release. Los cambios de contenido, en cambio, son exactamente para lo que existe el panel.

**CMS-105 (SHOULD)** — El pipeline detecta drift: compara las extensiones presentes en producción contra el manifiesto y alerta si divergen.

## 13.2 El contenido

**CMS-110 (MUST)** — El contenido —entradas, páginas, usuarios, medios, configuración editorial— es **estado de producción**. No se versiona en el repositorio y no se restaura desde él durante un deployment.

**CMS-111 (MUST)** — La sincronización entre entornos tiene una sola dirección permitida:

```text
Producción  ──►  Staging  ──►  Local
```

Nunca a la inversa. Un deploy jamás sobrescribe la base de datos de producción con un dump de otro entorno.

**CMS-112 (MUST)** — Los archivos subidos por usuarios viven en almacenamiento persistente: volumen dedicado en Perfil A, **object storage en Perfiles B y C**. Nunca dentro de la imagen ni en el filesystem efímero del contenedor.

**CMS-113 (SHOULD)** — Los dumps que salen de producción hacia entornos inferiores se anonimizan si contienen datos personales.

**CMS-114 (SHOULD)** — La configuración estructural que sí debe viajar entre entornos (tipos de contenido, campos, roles, opciones de tema) se gestiona como configuración exportable versionada, no a mano en cada entorno.

## 13.3 Backup y upgrades

**CMS-120 (MUST)** — Antes de toda release que modifique la versión del core, el pipeline ejecuta y **verifica** un backup de la base de datos y de los archivos. Verificar significa comprobar que el backup existe y es restaurable, no solo que el comando terminó.

Esto no es exceso de cautela: un upgrade de core migra el esquema, y volver a fijar la imagen anterior no revierte esa migración. Sin backup, la vía CMS no tiene rollback real.

**CMS-121 (MUST)** — Las migraciones internas del CMS se ejecutan como paso explícito del pipeline tras el deploy, no al azar del primer visitante que llegue al sitio.

```bash
wp core update-db --allow-root      # WordPress
ghost migrate                       # Ghost
strapi migrate                      # según CMS
```

**CMS-122 (MUST)** — Un upgrade de MAJOR del core se prueba antes en staging con una copia reciente de producción. No se estrena en producción.

**CMS-123 (SHOULD)** — Las releases que tocan el core se despliegan con el sitio en modo mantenimiento si el CMS lo soporta.

## 13.4 Configuración

**CMS-140 (MUST)** — El CMS lee su configuración desde variables de entorno provistas por el secret único. El archivo de configuración del CMS está versionado pero **no contiene valores**, solo lecturas:

```php
// wp-config.php — versionado, sin secretos
define('DB_NAME',     getenv('DB_NAME'));
define('DB_USER',     getenv('DB_USER'));
define('DB_PASSWORD', getenv('DB_PASSWORD'));
define('AUTH_KEY',    getenv('AUTH_KEY'));
```

**CMS-141 (MUST)** — Las claves de sesión y salts del CMS son secretos: viven en `<SECRET_NAME>`, no en el repositorio. Rotarlas cierra todas las sesiones, así que se rotan de forma deliberada, no en cada deploy.

**CMS-142 (MUST)** — La URL pública del sitio se configura por entorno. Un dump de producción restaurado en staging no debe dejar el sitio apuntando a producción.

## 13.5 Salud y versión

**CMS-130 (MUST)** — El CMS expone `/health` y `/version` mediante un plugin, módulo o ruta propia mínima. Los CMS no traen estos endpoints, y sin ellos `INF-503` no se puede cumplir.

```php
// mu-plugin: health.php
add_action('rest_api_init', function () {
    register_rest_route('ops/v1', '/version', [
        'methods'  => 'GET',
        'callback' => fn() => ['version' => getenv('APP_VERSION')],
        'permission_callback' => '__return_true',
    ]);
});
```

**CMS-131 (MUST)** — `/version` devuelve la versión de la **release del proyecto**, inyectada como variable de entorno en el build o en el compose. No la versión del core del CMS.

**CMS-132 (SHOULD)** — `/health` verifica conectividad con la base de datos y con el almacenamiento de medios, no solo que el proceso responda.

## 13.6 Verificación en lugar de tests unitarios

**CMS-150 (MUST)** — La etapa 3 del pipeline (`INF-310`) se cumple con smoke tests contra el stack recién levantado. Como mínimo:

- la home responde `200`;
- el panel de administración responde `200`;
- todos los plugins del manifiesto están activos;
- no hay errores fatales en el log tras el arranque;
- una página de contenido representativa renderiza sin error.

**CMS-151 (SHOULD)** — Los smoke tests se ejecutan también contra producción después del deploy, no solo contra el entorno de CI.

**CMS-152 (SHOULD)** — Si el sitio tiene formularios o checkout, se verifica al menos una ruta crítica end-to-end.

## 13.7 Headless: dos canales de despliegue

Aplica cuando `headless: true`. Es el punto donde más proyectos rompen el estándar sin darse cuenta.

Un sitio headless tiene dos cosas que cambian a ritmos completamente distintos: el **código** (cambia con releases, semanas) y el **contenido** (cambia con publicaciones, minutos). Tratarlos con el mismo mecanismo produce uno de dos desastres: o cada publicación dispara un deploy de infraestructura, o los editores esperan una release para ver su nota publicada.

**CMS-160 (MUST)** — Los dos canales están separados y no se mezclan:

```text
CANAL CÓDIGO                        CANAL CONTENIDO
Release SemVer                      Publicación en el CMS
      │                                   │
      ▼                                   ▼
Pipeline completo (§7)              Webhook de contenido
      │                                   │
      ▼                                   ▼
Nueva imagen + deploy               Rebuild/revalidación
                                    con la MISMA imagen
```

**CMS-161 (MUST)** — El canal de contenido **nunca** modifica versiones de imagen, ni toca el compose, ni dispara el webhook de deploy. Solo regenera o revalida contenido con el artefacto ya desplegado.

**CMS-162 (MUST)** — Una falla del canal de contenido no marca el deployment como fallido, ni al revés. Son independientes.

**CMS-163 (SHOULD)** — El frontend headless cumple `APP-100` y `APP-102`: sus propios tests y su propia imagen construida desde el repositorio.

**CMS-164 (SHOULD)** — Si el frontend es estático y el CMS cae, el sitio publicado sigue en línea. Esa es la principal ventaja de la arquitectura y conviene no perderla por una dependencia en tiempo de request.

---

# 14. Desviaciones

Un proyecto puede apartarse de una regla `SHOULD`, y excepcionalmente de una `MUST`, siempre que quede registrado. Sin registro, la desviación es un defecto.

**INF-900 (MUST)** — Las desviaciones viven en `docs/DEVIATIONS.md` con este formato:

```md
## CMS-105 — Detección de drift

**Estado:** desviación aceptada
**Fecha:** 2026-03-14
**Aprobado por:** <nombre>

**Motivo**
El sitio tiene tres plugins y un único administrador. El costo de
automatizar la detección supera al de una revisión manual trimestral.

**Mitigación**
Revisión manual del manifiesto contra producción cada trimestre.

**Revisión**
2026-09-01
```

**INF-901 (MUST)** — Un agente de IA no crea ni aprueba desviaciones por su cuenta. Puede proponerlas.

---

# 15. Agentes de IA

## 15.1 Antes de cambiar algo

**INF-800 (MUST)** — Antes de modificar contenedores, orquestación, CI/CD, deployments, secretos, variables de entorno, servicios de datos, networking o producción, el agente debe leer:

1. `INFRASTRUCTURE.md` (este archivo)
2. `AGENTS.md`
3. `infra.project.yml` — **especialmente `track` y `profile`**
4. `.env.example`
5. `docker-compose.yml`
6. los workflows del CI

y comprender la arquitectura existente antes de modificarla.

**INF-801 (MUST)** — El agente aplica las reglas de la vía declarada. No asume vía aplicación por defecto: en un proyecto CMS, tratar el contenido como si fuera código destruye datos de producción.

## 15.2 Prohibido

**INF-810 (MUST NOT)** — El agente no debe:

- usar `latest` ni tags flotantes en producción;
- desplegar producción automáticamente en cada push a la rama principal;
- crear un secret por variable, ni fragmentar el secret único;
- versionar `.env` reales, passwords en el compose o claves en el código;
- exponer secretos en variables de frontend;
- replicar la configuración de runtime en los secretos del CI;
- publicar imágenes de producción sin tag SemVer;
- disparar el deploy antes de actualizar el compose;
- reportar éxito con la verificación fallida;
- eliminar volúmenes persistentes durante un deployment;
- rediseñar la infraestructura sin que se lo pidan.

**CMS-810 (MUST NOT)** — En vía CMS, además, el agente no debe:

- versionar la base de datos de contenido ni incluirla en el repositorio;
- restaurar un dump hacia producción;
- proponer instalar o actualizar plugins desde el panel;
- habilitar las actualizaciones automáticas del core;
- montar código por bind mount o sincronizarlo por FTP en producción;
- tocar el compose o las versiones de imagen desde el canal de contenido;
- ejecutar un upgrade de core sin backup verificado previo.

## 15.3 Requerido

**INF-811 (MUST)** — El agente debe: mantener `.env.example` al día, usar el secret único, respetar la precedencia de configuración, exponer salud y versión, versionar el compose, usar imágenes inmutables y SemVer, verificar los deployments y mantener el proyecto portable.

**INF-812 (MUST)** — Ante una dependencia nueva (base de datos, cache, cola, worker, cron, observabilidad), el agente verifica primero si ya existe un servicio equivalente en el stack. No se duplica infraestructura.

**CMS-811 (MUST)** — En vía CMS, ante un plugin o tema nuevo, el agente lo agrega al manifiesto versionado (`CMS-102`), lo incluye en la imagen (`CMS-101`) y lo cubre en los smoke tests (`CMS-150`).

## 15.4 Atribución

**INF-820 (MUST)** — La autoría refleja quién hizo realmente el cambio:

```text
Cambio manual        →  autor = desarrollador
Cambio del pipeline  →  autor = bot del CI
Cambio con un agente →  autor principal + Co-authored-by del agente
```

**INF-821 (MUST)** — Los commits automáticos del CI se identifican como el bot de la plataforma:

```yaml
- name: Configure Git author
  run: |
    git config user.name  "github-actions[bot]"
    git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
```

```yaml
- name: Commit pinned compose
  run: |
    git add docker-compose.yml
    git diff --cached --quiet || \
      git commit -m "chore(release): pin images to ${GITHUB_REF_NAME}"
    git push
```

**INF-822 (MUST)** — Cuando un agente participa realmente, su contribución queda visible mediante trailers `Co-authored-by`, con la identidad oficial que provee la herramienta:

```text
feat: add document ingestion pipeline

Co-authored-by: Claude <noreply@anthropic.com>
```

**INF-823 (MUST NOT)** — No inventar identidades ni direcciones de bots. No atribuir un cambio a un agente que no participó. No fabricar actividad en el gráfico de contribuciones. La atribución existe para trazabilidad, no para decoración.

**INF-824 (SHOULD)** — Si la herramienta soporta atribución automática de coautoría, se mantiene habilitada salvo pedido explícito en contrario.

---

# 16. Checklist de conformidad

## 16.1 Común a ambas vías

**Instanciación**
- [ ] §0 completa y `infra.project.yml` sincronizado
- [ ] Vía y perfil declarados

**Artefactos**
- [ ] Releases SemVer; sin `latest` ni tags flotantes
- [ ] Tags inmutables; imágenes nunca sobrescritas
- [ ] Compose fija versiones explícitas

**Configuración**
- [ ] Un único secret `<SECRET_NAME>`, declarado como externo
- [ ] Montado en `/run/secrets/<SECRET_NAME>`
- [ ] Precedencia implementada; misma imagen en dev y prod
- [ ] Validación de config al arranque, fail-fast
- [ ] `.env.example` completo; `.env` ignorado

**Pipeline**
- [ ] Disparado por release, no por push
- [ ] Etapas en el orden de §7.2, todas bloqueantes
- [ ] Deploy disparado después del push del compose
- [ ] Estrategia de migraciones declarada
- [ ] Sin éxito falso posible

**Verificación**
- [ ] `/health` y `/version` implementados
- [ ] Versión comprobada post-deploy
- [ ] Reintentos y timeout definidos

**Persistencia y seguridad**
- [ ] Volúmenes persistentes para servicios con estado
- [ ] Ningún secreto en el repositorio ni en el frontend
- [ ] Rollback probado al menos una vez

## 16.2 Adicional — vía Aplicación

- [ ] Tests automatizados bloqueantes
- [ ] Migraciones versionadas junto al código
- [ ] La imagen no descarga nada en tiempo de arranque
- [ ] Lockfile de dependencias versionado

## 16.3 Adicional — vía CMS

- [ ] Imagen upstream fijada a versión exacta con patch
- [ ] Manifiesto de core, plugins y temas versionado
- [ ] Actualizaciones automáticas deshabilitadas
- [ ] Instalación desde el panel bloqueada
- [ ] Código dentro de la imagen, sin bind mounts ni FTP
- [ ] Contenido nunca restaurado hacia producción
- [ ] Medios en volumen persistente u object storage según perfil
- [ ] Backup verificado antes de releases que tocan el core
- [ ] Migraciones del CMS como paso explícito del pipeline
- [ ] `/health` y `/version` provistos por módulo propio
- [ ] Smoke tests cubriendo home, panel y plugins activos
- [ ] Headless: canales de código y contenido separados

---

# 17. Regla de oro

> **Un proyecto, un secret de configuración.**
>
> **Una release, una imagen inmutable.**
>
> **El repositorio es el estado deseado; el runtime solo lo aplica.**
>
> **En un CMS, el repositorio define el sitio y producción define el contenido: nunca al revés.**
>
> **Los commits automáticos pertenecen al bot del pipeline.**
>
> **Los agentes reciben atribución solo cuando participaron de verdad.**
>
> **Un deployment exitoso existe únicamente cuando producción responde saludable y con la versión esperada.**

Estas reglas no se modifican sin autorización explícita ni sin registrar la desviación según §14.

---
---

# Anexo A — `infra.project.yml`

Fuente legible por máquina de la §0. Permite validar conformidad automáticamente y que los agentes lean la instancia sin parsear prosa.

## A.1 Vía Aplicación

```yaml
standard:
  name: infrastructure-deployment-standard
  version: "2.1.0"

project:
  org: <ORG>
  name: <PROJECT>
  snake: <PROJECT_SNAKE>
  track: app
  profile: A

registry:
  host: ghcr.io
  image_base: ghcr.io/<ORG>/<PROJECT>
  immutable_tags: true
  platforms: [linux/amd64]

runtime:
  manager: portainer
  trigger: webhook

config:
  secret_name: <PROJECT_SNAKE>_env
  secret_path: /run/secrets/<PROJECT_SNAKE>_env
  dev_file: .env

health:
  url: <HEALTH_URL>
  health_path: /health
  version_path: /version
  retries: 10
  interval_seconds: 6

migrations:
  strategy: entrypoint     # entrypoint | job | manual

app:
  tests: required
  lockfile: package-lock.json

services:
  - { name: backend,  image: ghcr.io/<ORG>/<PROJECT>-backend,  needs_secret: true,  stateful: false }
  - { name: postgres, image: postgres:16.4,                    needs_secret: true,  stateful: true  }

deviations: []
```

## A.2 Vía CMS

```yaml
standard:
  name: infrastructure-deployment-standard
  version: "2.1.0"

project:
  org: <ORG>
  name: <PROJECT>
  snake: <PROJECT_SNAKE>
  track: cms
  profile: A

cms:
  engine: wordpress
  upstream_image: wordpress:6.8.1-php8.3-fpm
  headless: false
  custom_image: true               # se construye FROM upstream (CMS-101)
  manifest: composer.json          # CMS-102
  auto_updates: disabled           # CMS-103
  admin_installs: blocked          # CMS-104
  content_sync: prod-to-lower-only # CMS-111
  media_storage: volume            # volume | object_storage (CMS-112)
  backup_before_core_upgrade: required
  cms_migration_command: "wp core update-db --allow-root"

registry:
  host: ghcr.io
  image_base: ghcr.io/<ORG>/<PROJECT>
  immutable_tags: true

runtime:
  manager: portainer
  trigger: webhook

config:
  secret_name: <PROJECT_SNAKE>_env
  secret_path: /run/secrets/<PROJECT_SNAKE>_env
  dev_file: .env

health:
  url: <HEALTH_URL>
  health_path: /wp-json/ops/v1/health
  version_path: /wp-json/ops/v1/version
  retries: 15
  interval_seconds: 6

smoke_tests:                       # CMS-150
  - home_200
  - admin_200
  - plugins_active
  - no_fatal_errors

services:
  - { name: web,   image: ghcr.io/<ORG>/<PROJECT>, needs_secret: true, stateful: false }
  - { name: db,    image: mariadb:11.4.3,          needs_secret: true, stateful: true  }
  - { name: media, volume: <PROJECT>_uploads,      stateful: true }

deviations: []
```

---

# Anexo B — Adaptadores de carga de configuración

El contrato de `INF-220` es idéntico en todos los casos: si existe el archivo de secret, se carga; si no, se usa `.env`; las variables del proceso siempre ganan.

**Python**

```python
import os
from pathlib import Path
from dotenv import load_dotenv

PROJECT = os.getenv("PROJECT_NAME", "<PROJECT_SNAKE>")
secret = Path(f"/run/secrets/{PROJECT}_env")
load_dotenv(secret if secret.exists() else ".env", override=False)
```

**Node.js**

```javascript
import fs from "node:fs";
import dotenv from "dotenv";

const project = process.env.PROJECT_NAME ?? "<PROJECT_SNAKE>";
const secret = `/run/secrets/${project}_env`;
dotenv.config({ path: fs.existsSync(secret) ? secret : ".env", override: false });
```

**Go**

```go
project := getenv("PROJECT_NAME", "<PROJECT_SNAKE>")
secret := "/run/secrets/" + project + "_env"

path := ".env"
if _, err := os.Stat(secret); err == nil {
    path = secret
}
_ = godotenv.Load(path) // no sobrescribe variables ya definidas
```

**Shell / entrypoint** — el adaptador universal, y el que corresponde a la mayoría de los CMS: el secret se exporta como variables de entorno antes de arrancar el proceso, y el CMS solo lee `getenv`.

```bash
#!/bin/sh
SECRET="/run/secrets/${PROJECT_NAME}_env"
[ -f "$SECRET" ] && set -a && . "$SECRET" && set +a
exec "$@"
```

**PHP / WordPress** — con el entrypoint anterior en su lugar, `wp-config.php` queda versionado y sin valores:

```php
define('DB_NAME',     getenv('DB_NAME'));
define('DB_USER',     getenv('DB_USER'));
define('DB_PASSWORD', getenv('DB_PASSWORD'));
define('DB_HOST',     getenv('DB_HOST'));
define('AUTH_KEY',    getenv('AUTH_KEY'));
define('WP_HOME',     getenv('WP_HOME'));
define('WP_SITEURL',  getenv('WP_SITEURL'));
```

**JVM / .NET** — cargar el archivo como fuente de configuración adicional con menor prioridad que las variables de entorno.

---

# Anexo C — Plantillas de `AGENTS.md`

## C.1 Vía Aplicación

```md
# Project Instructions

Track: app · Profile: A

Before making infrastructure changes, read:
INFRASTRUCTURE.md · infra.project.yml · .env.example · docker-compose.yml · .github/workflows/

Key rules:

- Production is release-driven (SemVer tags), never push-driven.
- Never use `latest` or floating tags; images are immutable.
- One configuration secret per project: `<PROJECT_SNAKE>_env`.
- Production config loads from /run/secrets/<PROJECT_SNAKE>_env; development from .env.
- Never commit .env; always keep .env.example updated.
- Never expose backend secrets through frontend build variables.
- Automated tests are a blocking pipeline stage.
- The image is built entirely from the repo; nothing is downloaded at startup.
- The pipeline updates and pushes the compose before triggering the deploy.
- Every deployment ends with a health AND version check against production.
- Automated commits are authored by the CI bot; agents get Co-authored-by only when
  they actually contributed.

Deviations require an entry in docs/DEVIATIONS.md, approved by a human.
Do not redesign these conventions unless explicitly requested.
```

## C.2 Vía CMS

```md
# Project Instructions

Track: cms · Engine: <CMS> · Profile: A

Before making infrastructure changes, read:
INFRASTRUCTURE.md (esp. §13) · infra.project.yml · .env.example · docker-compose.yml · .github/workflows/

The core principle: the repository defines how the site looks and what it can do.
Production defines what it contains. Never confuse the two.

Key rules:

- Upstream image is pinned to an exact patch version. Never `latest` or floating tags.
- Themes, plugins and config ship INSIDE the image. No bind mounts, no FTP, no rsync.
- The plugin/theme manifest in the repo is the source of truth. Installing from the
  admin panel is prohibited — the panel is for content, not for deployment.
- CMS auto-updates are disabled in production.
- Content (posts, media, users) is production state. Never versioned, never restored
  from the repo, never pushed upward from staging.
- Media lives in a persistent volume (Profile A) or object storage (Profiles B/C).
- A verified backup runs before any release that changes the core version.
- CMS migrations run as an explicit pipeline step after deploy.
- /health and /version are provided by a project-owned module; /version returns the
  project release, not the CMS core version.
- Tests are smoke tests: home 200, admin 200, plugins active, no fatal errors.
- Headless only: content webhooks never change image versions or touch the compose.

Deviations require an entry in docs/DEVIATIONS.md, approved by a human.
Do not redesign these conventions unless explicitly requested.
```

---

# Anexo D — Placeholders

| Placeholder | Ejemplo | Dónde se define |
|---|---|---|
| `<ORG>` | `acme` | §0 |
| `<PROJECT>` | `acme-site` | §0 |
| `<PROJECT_SNAKE>` | `acme_site` | derivado |
| `<TRACK>` | `cms` | §0 |
| `<PROFILE>` | `A` | §0 |
| `<REGISTRY>` | `ghcr.io` | §0 |
| `<IMAGE_BASE>` | `ghcr.io/acme/acme-site` | derivado |
| `<SECRET_NAME>` | `acme_site_env` | derivado |
| `<UPSTREAM_IMAGE>` | `wordpress:6.8.1-php8.3-fpm` | §0, solo vía CMS |
| `<RUNTIME_MANAGER>` | `portainer` | §0 |
| `<HEALTH_URL>` | `https://acme.com` | §0 |
