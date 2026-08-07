# Propuesta MVP — Digitalización y búsqueda de remitos con OCR

> **Documento fuente de verdad.** Define alcance, requerimientos y flujo del MVP.
> Decisiones vigentes del usuario (2026-08-07):
> - El OCR extrae **únicamente cuatro campos**: fecha y hora, número de remito, número de cliente y nombre del cliente.
> - El flujo canónico es **Drive → OCR → ordenar en Drive (crear carpeta del cliente) → crear registro en BD → mostrar en frontend**.
> - n8n solo orquesta (Drive + scheduling). FastAPI concentra OCR, schema, confianza y duplicados.

---

## 1. Objetivo

Construir un MVP para un único cliente que permita:

1. Subir remitos en formato PDF o imagen a una carpeta de Google Drive.
2. Detectar automáticamente los archivos nuevos.
3. Analizar cada archivo con un modelo multimodal (OCR + visión).
4. Extraer **solo cuatro datos** de cada remito: fecha y hora, número de remito, número de cliente y nombre del cliente.
5. Crear o reutilizar una carpeta en Drive según el número de cliente.
6. Mover el archivo procesado a la carpeta del cliente.
7. Registrar los cuatro datos extraídos y el enlace al archivo en PostgreSQL.
8. Consultar los remitos desde un frontend básico.

El MVP está pensado para un único formato de remito (los ejemplos entregados de Martín Materiales Eléctricos). No se diseñará inicialmente para múltiples proveedores ni documentos con estructuras diferentes.

---

## 2. Alcance del MVP

### Incluido

- Un único cliente/empresa usuaria.
- Un único formato conocido de remito.
- Entrada mediante PDF, JPG, JPEG o PNG.
- Archivos de una o varias páginas (cada página es un remito).
- Procesamiento de varias cargas consecutivas.
- Organización automática en Google Drive, una carpeta por número de cliente.
- Registro del remito con sus cuatro campos clave.
- Búsqueda desde un frontend por los cuatro campos clave.
- Prevención de archivos duplicados por `drive_file_id`.
- Revisión manual cuando la confianza o los campos obligatorios no alcancen.

### Fuera de alcance inicialmente

- Sistema multiempresa.
- Aplicación móvil propia.
- Distintos modelos de remitos de múltiples proveedores.
- Entrenamiento de un modelo OCR personalizado.
- Extracción de artículos, descripción de productos, totales, importes o cualquier campo distinto de los cuatro definidos.
- Procesamiento masivo de cientos o miles de documentos por hora.
- Microservicios.
- Kubernetes.
- Colas distribuidas complejas.
- Roles y permisos avanzados.
- Facturación o integración con sistemas contables.
- Eliminación automática de documentos originales.

---

## 3. Datos a extraer

**Decisión dura del usuario:** el OCR extrae **únicamente** estos cuatro campos por remito. Cualquier otro dato que aparezca en el JSON de respuesta es un error.

| Campo | Tipo | Descripción |
|---|---|---|
| `fecha_hora` | string ISO | Fecha y hora de emisión del remito. La fecha en formato `AAAA-MM-DD` y la hora en `HH:MM`. Si la hora no es legible, se acepta `fecha_hora` solo con la fecha. |
| `remito` | string | Número de remito en formato canónico `B 5001 00123456` (prefijo `B`, `5001`, dígitos). Si el original no sigue ese patrón, se transcribe tal cual. |
| `n_cliente` | string | Número de cliente tal como está impreso (ej. `12299`). |
| `cliente` | string | Nombre del cliente tal como está impreso (ej. `CONSORCIO EDIF KALEM`). |

Adicionalmente el backend registra, con fines de auditoría y de protección del flujo:

- `confidence` (float 0.0–1.0): confianza global reportada por el modelo.
- `status` (enum): estado del procesamiento (`processed` o `requires_review`).
- `drive_file_id` y `drive_file_link`: referencia al archivo en Drive.
- `page_number`: número de página dentro del archivo original.

**No se extraen** ni se persisten: dirección, localidad, proveedor, vendedor, CUIT, condición de venta, obra, firma, artículos, líneas de producto, totales, importes ni notas.

---

## 4. Arquitectura simplificada

```text
Google Drive (carpeta Pendientes)
    ↓
n8n (detecta archivos nuevos, descarga, llama al backend)
    ↓
FastAPI (procesa el archivo: OCR + extracción + validación)
    ↓
n8n (con el resultado: crea/encuentra carpeta del cliente y mueve el archivo)
    ↓
PostgreSQL (registro del remito con los 4 campos)
    ↓
Frontend React (consulta y muestra los remitos)
```

### Componentes

#### Google Drive

Se utiliza como:

- Bandeja de entrada (`Pendientes/`).
- Almacenamiento final organizado por cliente.
- Fuente del enlace que verá el usuario.

#### n8n

Se encarga **únicamente** de:

- Consultar periódicamente la carpeta `Pendientes/`.
- Detectar archivos nuevos.
- Descargar el binario.
- Llamar al endpoint interno de FastAPI para procesar.
- Recibir el resultado y mover el archivo a la carpeta del cliente.
- Crear la carpeta del cliente si no existe (`{n_cliente} - {cliente}/<año>/`).

#### FastAPI

Concentra **toda** la lógica de valor:

- OCR multimodal (Gemini) y extracción estructurada a JSON.
- Validación de los cuatro campos obligatorios.
- Cálculo del estado (`processed` vs `requires_review`).
- Persistencia en PostgreSQL.
- Prevención de duplicados por `drive_file_id`.
- Exposición de endpoints al frontend.

#### PostgreSQL

Guarda:

- Clientes (`clients`).
- Remitos (`delivery_notes`) con los cuatro campos clave.
- Archivos origen (`source_files`) con `drive_file_id` único.
- Estados y confianza.

#### React

Frontend simple para:

- Buscar remitos por los cuatro campos clave.
- Filtrar resultados.
- Ver el estado.
- Abrir el archivo en Drive.

---

## 5. Procesamiento por lotes

El sistema no procesa todos los archivos pendientes al mismo tiempo.

### Flujo propuesto

1. n8n consulta la carpeta `Pendientes`.
2. Detecta los archivos nuevos y los registra en `source_files` con `status=pending`.
3. Selecciona un máximo de dos o tres archivos por lote.
4. Para cada archivo: descarga → llama a FastAPI → recibe el resultado → crea/encuentra carpeta del cliente → mueve el archivo → actualiza estado.
5. Al terminar, toma los siguientes.

### Configuración inicial recomendada

```env
PROCESSING_BATCH_SIZE=3
MAX_CONCURRENT_FILES=3
MAX_RETRIES=3
PROCESSING_TIMEOUT_SECONDS=120
```

### Estados básicos

```text
pending
processing
processed
requires_review
duplicate
error
```

---

## 6. Una página = un remito

**Decisión vigente:** se eliminó la detección de "uno o dos remitos por imagen" mediante coordenadas o recortes. Cada página del PDF, o cada imagen subida, corresponde a **un único remito**.

- Si el archivo es un PDF de varias páginas, cada página genera un registro independiente con su propio `page_number`.
- Si el archivo es una imagen, genera un único registro.
- No hay recorte, ni OpenCV, ni detector visual de cuadros.

---

## 7. Flujo completo del sistema

```text
1. El usuario sube imágenes o PDFs a Google Drive (carpeta Pendientes).
2. n8n detecta los archivos nuevos.
3. n8n registra cada archivo en PostgreSQL como pending.
4. n8n toma hasta tres archivos.
5. n8n descarga el archivo y lo envía a FastAPI.
6. FastAPI convierte el PDF en imágenes si es necesario (una imagen por página).
7. FastAPI envía cada imagen al modelo multimodal con el prompt de cuatro campos.
8. FastAPI valida: ¿están los cuatro campos? ¿la confianza es suficiente?
9. FastAPI persiste el remito con status processed o requires_review.
10. n8n recibe el resultado: n_cliente y cliente.
11. n8n busca la carpeta del cliente en Drive.
12. Si no existe, la crea como "{n_cliente} - {cliente}/<año>/".
13. n8n mueve el archivo original a esa carpeta.
14. El frontend consulta la BD y muestra el remito.
15. Si hay dudas (confidence bajo o campo faltante), el remito queda en requires_review.
```

---

## 8. Organización en Google Drive

### Estructura propuesta

```text
Remitos/
├── Pendientes/
└── Clientes/
    ├── 12293 - CONSORCIO LA ARGENTINA II/
    │   └── 2026/
    │       └── B-5001-00139454.pdf
    └── 12299 - CONSORCIO EDIF KALEM/
        └── 2026/
            ├── B-5001-00139455.pdf
            └── B-5001-00139595.pdf
```

### Identificación de la carpeta

Clave principal: `n_cliente`.
Nombre visible: `{n_cliente} - {cliente}`.
Subcarpeta por año: `<YYYY>/`.

El ID de la carpeta del cliente se guarda en `clients.drive_folder_id` para no volver a buscarla.

### Movimiento del archivo

Una vez procesado:

- El archivo se **mueve** desde `Pendientes/` a `Clientes/{n_cliente} - {cliente}/<YYYY>/`.
- El nombre final lleva el número de remito canónico como prefijo.

---

## 9. Prevención de duplicados

Antes de procesar un archivo:

```text
UNIQUE drive_file_id
```

Reglas:

- Si el archivo de Drive ya fue procesado (`status != pending`), se ignora.
- Si el mismo `(n_cliente, remito)` ya existe, se marca como `duplicate`.
- Los duplicados no se eliminan automáticamente.
- El usuario puede revisarlos desde el frontend.

---

## 10. Modelo de datos simplificado

### Tabla `clients`

```sql
CREATE TABLE clients (
    id UUID PRIMARY KEY,
    client_number VARCHAR(50) NOT NULL UNIQUE,
    client_name TEXT NOT NULL,
    drive_folder_id TEXT,
    drive_folder_link TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Tabla `source_files`

```sql
CREATE TABLE source_files (
    id UUID PRIMARY KEY,
    drive_file_id TEXT NOT NULL UNIQUE,
    original_filename TEXT NOT NULL,
    original_drive_link TEXT,
    status VARCHAR(30) NOT NULL DEFAULT 'pending',
    detected_remitos INTEGER DEFAULT 0,
    attempts INTEGER DEFAULT 0,
    error_message TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    processed_at TIMESTAMPTZ
);
```

### Tabla `delivery_notes`

```sql
CREATE TABLE delivery_notes (
    id UUID PRIMARY KEY,
    source_file_id UUID NOT NULL REFERENCES source_files(id),
    client_id UUID REFERENCES clients(id),

    -- Únicos cuatro campos que extrae el OCR
    document_number VARCHAR(100),       -- remito (canónico: "B 5001 00123456")
    document_date DATE,                 -- parte de fecha de fecha_hora
    document_time TIME,                 -- parte de hora de fecha_hora
    client_number VARCHAR(50),          -- n_cliente
    client_name TEXT,                   -- cliente

    drive_file_id TEXT,
    drive_file_link TEXT,

    page_number INTEGER,
    signed BOOLEAN DEFAULT FALSE,
    confidence NUMERIC(5,4),
    status VARCHAR(30) DEFAULT 'processed',

    extraction_payload JSONB,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE (client_number, document_number, page_number)
);
```

**No existe** la tabla de ítems/artículos. Ese dato no se extrae ni se persiste.

---

## 11. Extracción estructurada

El modelo debe devolver **únicamente** JSON con los cuatro campos pedidos más `confidence`.

```json
{
  "document_number": "B 5001 00123456",
  "document_date": "2026-06-22",
  "document_time": "10:35",
  "client_number": "12299",
  "client_name": "CONSORCIO EDIF KALEM",
  "confidence": 0.92
}
```

### Reglas del prompt

- Devolver **solo** estos cinco campos.
- No inventar información.
- Usar `null` cuando un campo no sea legible (incluida la hora si no aparece).
- Respetar el formato de fecha `AAAA-MM-DD` y de hora `HH:MM`.
- Para el número de remito, preferir el formato canónico `B 5001 00123456`; si el original no encaja, transcribirlo literal.
- Si el texto es dudoso, bajar `confidence`.

### Proveedor

- Modelo multimodal Gemini (`gemini-3.1-flash-lite`) a través del endpoint compatible con OpenAI en `https://generativelanguage.googleapis.com`.
- La key se inyecta por variable de entorno (`OPENAI_API_KEY` en `backend/.env`).

---

## 12. Validaciones

### Campos críticos

Para considerar un remito como procesado automáticamente:

- `document_number` (remito) presente y no nulo.
- `client_number` (n_cliente) presente y no nulo.
- `client_name` (cliente) presente y no nulo.
- `document_date` (fecha) presente y parseable.
- `confidence >= 0.85`.

### Reglas

```text
Cuatro campos críticos presentes + confianza >= 0.85
→ processed
```

```text
Algún campo crítico faltante o confianza < 0.85
→ requires_review
```

La hora faltante **no** bloquea: si `document_date` está, basta para `processed`.

---

## 13. Frontend básico

### Pantalla principal

- Total de remitos.
- Pendientes.
- En revisión.
- Con errores.

### Buscador

Búsqueda por:

- `remito` (número de remito).
- `n_cliente` (número de cliente).
- `cliente` (nombre del cliente).
- `fecha_hora` (fecha).

### Tabla

| Estado | Fecha y hora | Remito | N.° cliente | Cliente | Archivo |
|---|---|---|---|---|---|
| Procesado | 2026-06-22 10:35 | B 5001 00139455 | 12299 | CONSORCIO EDIF KALEM | Ver |
| Procesado | 2026-06-22 11:10 | B 5001 00139595 | 12299 | CONSORCIO EDIF KALEM | Ver |

### Colores

```text
Verde: procesado
Amarillo: requiere revisión
Azul: procesando
Rojo: error
Gris: pendiente
Violeta: posible duplicado
```

### Vista de detalle

Al abrir un remito:

- Vista previa o enlace al archivo en Drive.
- Datos del cliente (`n_cliente`, `cliente`).
- Número de remito.
- Fecha y hora.
- Estado.
- Confianza.

---

## 14. Endpoints básicos

```http
GET    /api/remitos
GET    /api/remitos/{id}
GET    /api/remitos/search
PATCH  /api/remitos/{id}
POST   /api/remitos/{id}/approve
POST   /api/remitos/{id}/reprocess

GET    /api/clients
GET    /api/clients/{id}
GET    /api/clients/{id}/remitos

POST   /api/internal/source-files
PATCH  /api/internal/source-files/{id}/status
POST   /api/internal/source-files/{id}/process    -- recibe el binario, dispara OCR, persiste
POST   /api/internal/remitos
```

No es necesario implementar inicialmente una API extensa.

---

## 15. Workflows de n8n

Tres workflows para el MVP.

### Workflow 1 — Detectar archivos

```text
Schedule Trigger
→ Listar archivos de Pendientes
→ Verificar si existen en PostgreSQL (por drive_file_id)
→ Registrar nuevos como pending
```

Frecuencia inicial: cada 2 minutos.

### Workflow 2 — Procesar pendientes

```text
Schedule Trigger
→ Buscar hasta 3 source_files pending
→ Marcar processing
→ Descargar binario desde Drive
→ POST /api/internal/source-files/{id}/process (binario en body)
← Recibir {n_cliente, cliente, document_number, ...}
→ Buscar o crear carpeta del cliente en Drive
→ Crear subcarpeta del año si no existe
→ Mover archivo a la carpeta
→ El endpoint ya dejó el remito en processed o requires_review
```

Frecuencia inicial: cada minuto.

### Workflow 3 — Reintentos

```text
Schedule Trigger
→ Buscar source_files en error con attempts < 3
→ Reprocesar
→ Si vuelve a fallar, dejar en error
```

Frecuencia inicial: cada 10 minutos.

---

## 16. Tecnologías propuestas

```text
Frontend:   React + Tailwind CSS (Flat Design)
Backend:    FastAPI
Base de datos: PostgreSQL
Automatización: n8n
Archivos:   Google Drive
OCR/extracción: Gemini multimodal (gemini-3.1-flash-lite)
Conversión PDF: PyMuPDF o pdf2image
Procesamiento de imágenes: Pillow
Entorno Python: venv
```

Redis, Celery y OpenCV no son necesarios para el MVP. La detección de "uno o dos remitos" se descarta: cada página es un remito.

---

## 17. Plan de implementación

### Fase 1 — Base

- Crear tablas (`clients`, `source_files`, `delivery_notes` con solo los cuatro campos + auditoría).
- Crear backend FastAPI.
- Crear endpoints internos y públicos básicos.
- Conectar PostgreSQL.
- Conectar Google Drive (OAuth).
- Configurar carpeta `Pendientes`.

### Fase 2 — Extracción de los cuatro campos

- Prompt estricto de cuatro campos.
- Schema Pydantic con solo cuatro campos + `confidence`.
- Validación (cuatro presentes + confianza).
- Persistencia del remito.
- Limpieza de la tabla `delivery_notes` y reproceso de los archivos existentes para que solo queden los cuatro campos.

### Fase 3 — Organización en Drive

- Crear carpetas por número de cliente.
- Crear subcarpeta por año.
- Mover el archivo original.
- Guardar IDs y enlaces.

### Fase 4 — Frontend

- Tabla con los cuatro campos clave.
- Buscador por los cuatro campos clave.
- Filtros.
- Colores de estado.
- Detalle con los cuatro campos clave.

### Fase 5 — Pruebas

- Una imagen con un remito.
- Un PDF con varias páginas (cada página = un remito).
- Treinta archivos consecutivos.
- Archivo duplicado.
- Escaneo borroso.
- Datos incompletos (hora faltante, etc.).
- Error temporal del OCR.
- Reinicio de n8n durante el procesamiento.

---

## 18. Criterios de aceptación

El MVP se considerará funcional cuando:

1. El usuario suba fotos o PDFs a Drive y se detecten automáticamente.
2. Se puedan subir 30 documentos consecutivos sin bloquear el sistema.
3. El procesamiento se haga en lotes de hasta tres.
4. Un PDF de dos páginas genere dos remitos.
5. De cada remito se extraigan **únicamente** los cuatro campos definidos (fecha y hora, remito, n_cliente, cliente) más confianza y estado.
6. El JSON de extracción nunca incluya artículos, CUIT, dirección, totales ni ningún otro campo.
7. Se cree una carpeta por número de cliente y se mueva el archivo allí.
8. Cada remito tenga su archivo en Drive con enlace y su registro en la BD.
9. El frontend permita buscar por los cuatro campos clave.
10. El usuario pueda abrir el archivo desde la tabla.
11. Los documentos dudosos aparezcan en revisión.
12. Los duplicados no se procesen dos veces.
13. Los errores puedan reintentarse.

---

## 19. Riesgos principales

### Calidad de las fotos

Una imagen torcida, oscura o desenfocada puede bajar la confianza.

Mitigación: instrucciones simples al usuario, revisión manual, preprocesamiento básico de contraste y orientación.

### Hora del remito ilegible o ausente

La hora puede no estar impresa en todos los remitos.

Mitigación: la hora faltante no bloquea el procesamiento; solo `fecha` es obligatoria.

### Texto dudoso en los cuatro campos

Números de remito o de cliente pueden confundirse entre sí.

Mitigación: validación por formato, confianza por campo, vista lado a lado para corregir.

### Límites del proveedor OCR

Muchas cargas simultáneas pueden provocar demoras.

Mitigación: procesar tres archivos por vez, reintentos, estados visibles.

### Carpeta del cliente desactualizada

Si se cambia el nombre del cliente después de creada la carpeta, los archivos nuevos podrían no encontrarse.

Mitigación: usar `n_cliente` como clave estable de la carpeta y guardar el ID en la BD.

---

## 20. Decisiones cerradas

1. **Proveedor OCR/modelo multimodal**: Gemini (`gemini-3.1-flash-lite`) vía endpoint compatible OpenAI.
2. **Cuenta de Google Drive de prueba**: cuenta de desarrollo del usuario (carpeta `Pendientes/` y subcarpetas por cliente).
3. **Originales**: se mueven (no se copian) a la carpeta del cliente.
4. **Tiempo de conservación de originales**: indefinido (se mantienen en Drive).
5. **Campos exactos que necesita ver el cliente**: los cuatro definidos (fecha y hora, remito, n_cliente, cliente). No se exponen otros.
6. **Edición de artículos**: fuera de alcance. No hay artículos en este MVP.
7. **Exportación a Excel**: fuera de alcance del MVP.
8. **Búsqueda por descripción de productos**: no aplica. No hay descripciones en este MVP.
9. **Múltiples proveedores**: fuera de alcance. Solo Martín Materiales Eléctricos.
10. **Volumen esperado**: bajo a moderado (lotes de hasta 30 archivos).

---

## 21. Recomendación final

Para este caso no conviene una plataforma genérica ni una arquitectura distribuida.

La primera versión se construye con:

```text
Google Drive + n8n (solo orquesta) + FastAPI (OCR + extracción + BD) + PostgreSQL + React + Gemini multimodal
```

El OCR extrae **solo** los cuatro campos clave (fecha y hora, remito, n_cliente, cliente). El flujo canónico es Drive → OCR → ordenar en Drive → crear/actualizar registro en BD → visible en frontend. La carga se controla con cola simple en PostgreSQL y lotes de hasta tres archivos. Esto alcanza para validar el MVP sin colapsar ni introducir complejidad innecesaria.

Si después aparecen nuevos proveedores, mayor volumen o necesidad de procesamiento continuo, recién entonces se evaluará Redis, workers independientes o arquitectura multiempresa.
