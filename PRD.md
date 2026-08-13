# PRD — Plataforma de Digitalización, OCR y Gestión de Remitos

> **Documento fuente de verdad — nueva arquitectura.**
>
> Esta versión reemplaza la propuesta anterior basada en Google Drive y n8n.
> Toda la lógica del sistema se implementará a código utilizando React, FastAPI/Python, PostgreSQL y MinIO.

---

## 1. Objetivo del producto

Construir una aplicación web responsive para digitalizar, procesar, almacenar, consultar y revisar remitos desde escritorio o celular.

El usuario podrá:

1. Subir uno o varios remitos desde una computadora o dispositivo móvil.
2. Desde celular, sacar una o varias fotografías directamente desde la plataforma web.
3. Recibir archivos PDF, JPG, JPEG, PNG y otros formatos de imagen compatibles.
4. Comprimir/optimizar los documentos antes de almacenarlos, buscando un tamaño objetivo aproximado de **300 KB por imagen/remito**, siempre preservando calidad suficiente para OCR.
5. Almacenar los archivos en **MinIO** en lugar de Google Drive.
6. Procesar automáticamente cada archivo mediante OCR/visión multimodal.
7. Extraer exclusivamente los cinco campos definidos para cada remito.
8. Guardar los datos estructurados en PostgreSQL.
9. Consultar, buscar, filtrar y visualizar los remitos desde una aplicación React.
10. Abrir la imagen/PDF original o procesado desde la propia aplicación.
11. Revisar y corregir manualmente un remito cuando el OCR no pueda leer un dato de forma confiable.

El MVP estará inicialmente orientado a los remitos del formato ya relevado para el cliente.

---

## 2. Principios de arquitectura

### Decisiones cerradas

- **No utilizar Google Drive.**
- **No utilizar n8n para el flujo principal.**
- Toda la lógica de negocio estará implementada a código.
- Backend principal: **Python + FastAPI**.
- Frontend: **React**.
- Base de datos: **PostgreSQL**.
- Almacenamiento de archivos: **MinIO / S3 compatible**.
- OCR / visión: **Gemini 3.5 Flash** como modelo objetivo, configurable por variable de entorno.
- La misma aplicación web tendrá interfaz desktop y mobile responsive.
- La interfaz mobile permitirá utilizar la cámara del dispositivo para capturar remitos.

### Arquitectura general

```text
Usuario desktop / mobile
        ↓
React Web App
  ├─ selección de archivos
  ├─ carga múltiple
  └─ captura con cámara en mobile
        ↓
FastAPI
  ├─ validación de archivo
  ├─ compresión / optimización
  ├─ hash y control de duplicados
  ├─ almacenamiento en MinIO
  ├─ creación del trabajo OCR
  ├─ procesamiento OCR Gemini
  ├─ normalización y validación JSON
  └─ persistencia PostgreSQL
        ↓
PostgreSQL  ←→  MinIO
        ↓
React Web App
  ├─ listado
  ├─ búsqueda
  ├─ filtros
  ├─ detalle
  ├─ revisión manual
  └─ visualización del documento
```

---

## 3. Alcance del MVP

### Incluido

- Aplicación web responsive.
- Interfaz desktop y mobile bajo el mismo dominio.
- Captura de fotografías desde cámara mobile mediante navegador.
- Carga individual o múltiple.
- PDF e imágenes.
- Posibilidad de detectar uno o varios remitos visibles en el archivo recibido, según respuesta del modelo.
- Almacenamiento de documentos en MinIO.
- Optimización de imágenes con objetivo aproximado de 300 KB.
- OCR multimodal con Gemini 3.5 Flash.
- Extracción estricta de cinco campos.
- Persistencia de remitos en PostgreSQL.
- Búsqueda y filtros.
- Vista de detalle.
- Visualización/descarga controlada del archivo mediante URL firmada o endpoint seguro.
- Estados de procesamiento.
- Reprocesamiento.
- Revisión y corrección manual.
- Prevención de duplicados.
- Registro de errores técnicos básicos.

### Fuera de alcance inicialmente

- Sistema multiempresa complejo.
- Aplicación móvil nativa Android/iOS.
- Google Drive.
- n8n para el procesamiento principal.
- Extracción de artículos/productos.
- Totales, precios, importes, CUIT, dirección, vendedor u otros datos no definidos.
- Entrenamiento de un modelo OCR propio.
- Microservicios.
- Kubernetes.
- Procesamiento industrial de miles de documentos simultáneos.
- Integraciones contables o ERP externas.

---

## 4. Datos que debe extraer el OCR

El OCR extraerá **únicamente cinco campos** por cada remito detectado:

| Campo | Tipo | Regla |
|---|---|---|
| `cliente` | `string \| null` | Nombre del cliente tal como aparece impreso. |
| `numero_cliente` | `string \| null` | Número de cliente. Debe conservar ceros iniciales. |
| `fecha_hora` | `string \| null` | Formato obligatorio `DD/MM/YYYY HH:mm`. |
| `numero_remito` | `string \| null` | Identificador completo visible del remito. |
| `comentarios` | `string \| null` | Texto del campo **Comentarios**, ubicado debajo de número de cliente en el formato actual. |

### Regla crítica para `numero_remito`

Debe preservarse **exactamente el identificador completo visible**.

Ejemplo:

```text
B 5001 00139454
```

Debe devolverse como:

```json
"numero_remito": "B 5001 00139454"
```

Nunca debe reducirse a:

```json
"numero_remito": "00139454"
```

Se deben conservar:

- letra o tipo de comprobante;
- punto de venta / sucursal;
- espacios;
- guiones;
- ceros iniciales;
- cualquier otro componente visible perteneciente al identificador.

### Regla para `comentarios`

- Extraer únicamente el contenido asociado al campo **Comentarios**.
- En el formato actual se encuentra debajo de `numero_cliente`.
- No confundirlo con artículos, observaciones de líneas de producto, firma u otros textos del remito.
- Si el campo está vacío o no puede leerse de forma confiable, devolver `null`.

---

## 5. Prompt de extracción OCR

El prompt base del agente será:

```text
Analiza el archivo recibido y detecta todos los remitos visibles.

Por cada remito extrae únicamente:

- cliente
- numero_cliente
- fecha_hora
- numero_remito
- comentarios

No extraigas ninguna otra información.

Regla CRÍTICA para numero_remito:

- Debe incluir el identificador COMPLETO visible del remito.
- Si el documento muestra algo como "B 5001 00139454", el valor correcto es exactamente "B 5001 00139454".
- No devuelvas solamente la última parte numérica.
- Conserva letra, punto de venta/sucursal, espacios, guiones y ceros iniciales tal como aparecen.

Regla para comentarios:

- Extrae únicamente el contenido del campo "Comentarios" correspondiente al remito.
- En el formato actual este campo se encuentra debajo de numero_cliente.
- No confundas comentarios con artículos, productos, firma, dirección u otros textos.
- Si no hay comentarios o no puede leerse el campo de manera confiable, utiliza null.

No inventes datos.
Si un campo no puede leerse de forma confiable, utiliza null.

Mantén numero_cliente y numero_remito como strings.
Conserva los ceros iniciales.

fecha_hora debe utilizar DD/MM/YYYY HH:mm.

Si existen múltiples remitos, devuelve todos.
Si no hay ningún remito reconocible, devuelve un array vacío.

Respondé SOLO con JSON válido, sin Markdown, sin explicación, sin texto adicional.

Schema esperado:
[
  {
    "cliente": string|null,
    "numero_cliente": string|null,
    "fecha_hora": string|null,
    "numero_remito": string|null,
    "comentarios": string|null
  }
]
```

---

## 6. Normalización de la respuesta del modelo

La aplicación debe asumir que el proveedor puede envolver la respuesta en diferentes estructuras y debe localizar el texto antes de parsearlo.

Código base actualizado:

```javascript
const out = [];
const allowedKeys = [
  'cliente',
  'numero_cliente',
  'fecha_hora',
  'numero_remito',
  'comentarios'
];

function extractText(json) {
  return json.text
    ?? json.output
    ?? json.response
    ?? json.result
    ?? json.content?.parts?.[0]?.text
    ?? json.candidates?.[0]?.content?.parts?.[0]?.text
    ?? json.data?.text
    ?? '';
}

function cleanJsonText(value) {
  let text = String(value || '').trim();
  text = text.replace(/^```(?:json)?\s*/i, '').replace(/```$/i, '').trim();

  const firstArray = text.indexOf('[');
  const lastArray = text.lastIndexOf(']');

  if (firstArray !== -1 && lastArray !== -1 && lastArray > firstArray) {
    text = text.slice(firstArray, lastArray + 1);
  }

  return text;
}

for (const item of items) {
  try {
    const raw = extractText(item.json);
    const parsed = JSON.parse(cleanJsonText(raw));

    if (!Array.isArray(parsed)) {
      out.push({
        json: {
          error: true,
          error_type: 'invalid_json',
          message: 'Model output is not an array',
          raw
        }
      });
      continue;
    }

    const remitos = parsed.map((row) => {
      const normalized = {};

      for (const key of allowedKeys) {
        const value = row && Object.prototype.hasOwnProperty.call(row, key)
          ? row[key]
          : null;

        normalized[key] = value === null || value === undefined || value === ''
          ? null
          : String(value);
      }

      return normalized;
    });

    out.push({ json: { error: false, remitos } });
  } catch (error) {
    out.push({
      json: {
        error: true,
        error_type: 'invalid_json',
        message: error.message,
        raw: extractText(item.json)
      }
    });
  }
}

return out;
```

> En la implementación FastAPI, esta misma normalización debe trasladarse a Python/Pydantic; el fragmento JavaScript queda documentado como referencia funcional del contrato esperado.

---

## 7. Flujo de carga desde desktop

```text
1. Usuario ingresa a la aplicación.
2. Presiona “Subir remitos”.
3. Selecciona uno o varios PDF/imágenes.
4. React muestra los archivos seleccionados.
5. Usuario confirma la carga.
6. React envía los archivos a FastAPI.
7. FastAPI valida tipo y tamaño.
8. Calcula hash del archivo para detectar duplicados exactos.
9. Optimiza/comprime cuando corresponda.
10. Guarda el archivo en MinIO.
11. Registra source_file en PostgreSQL.
12. Coloca el documento en estado pending/processing.
13. Ejecuta OCR.
14. Valida y normaliza la respuesta.
15. Crea uno o varios registros de remitos según el array devuelto.
16. La interfaz actualiza el estado del procesamiento.
```

---

## 8. Flujo mobile / cámara

La versión mobile será la **misma aplicación React responsive**, servida bajo el mismo dominio.

### Opciones de ingreso

#### A. Sacar foto

El usuario podrá abrir la cámara desde la propia plataforma mediante un input compatible con captura móvil.

Ejemplo conceptual:

```html
<input
  type="file"
  accept="image/*"
  capture="environment"
  multiple
/>
```

La implementación debe priorizar la cámara trasera del dispositivo cuando el navegador lo permita.

#### B. Elegir desde galería/archivos

El usuario podrá seleccionar:

- una fotografía;
- varias fotografías;
- un PDF;
- varios archivos consecutivos.

### Experiencia de captura

1. Abrir sección **Escanear remitos**.
2. Sacar foto o elegir archivo.
3. Mostrar miniatura.
4. Permitir agregar más remitos antes de enviar.
5. Permitir eliminar una captura incorrecta.
6. Botón **Procesar remitos**.
7. Mostrar progreso individual de cada archivo.
8. Mostrar resultado: procesado, revisión requerida, duplicado o error.

---

## 9. Compresión y optimización de archivos

### Objetivo

Reducir el consumo de almacenamiento y ancho de banda manteniendo suficiente calidad para OCR.

### Regla de 300 KB

Para imágenes se buscará un tamaño objetivo de **aproximadamente 300 KB**.

No debe aplicarse una compresión destructiva ciega que vuelva ilegible el documento.

Algoritmo sugerido:

```text
Imagen recibida
    ↓
Corregir orientación EXIF
    ↓
Convertir a RGB si corresponde
    ↓
Limitar resolución máxima si es excesiva
    ↓
Codificar progresivamente en JPEG/WebP
    ↓
Ajustar calidad hasta acercarse a TARGET_IMAGE_SIZE_KB=300
    ↓
Validar dimensión/calidad mínima
    ↓
Guardar versión optimizada
```

### Consideraciones

- Si una imagen ya pesa menos de 300 KB y tiene calidad suficiente, no es necesario recomprimirla.
- El objetivo de 300 KB es aproximado, no una condición rígida que justifique perder legibilidad.
- Para documentos con texto pequeño puede aceptarse un archivo mayor.
- Los PDF requieren tratamiento separado: optimización de imágenes internas o conservación del original si reducirlo compromete el OCR.
- El backend podrá generar una representación optimizada para OCR y conservar, si se decide, el original como respaldo.

### Configuración

```env
TARGET_IMAGE_SIZE_KB=300
IMAGE_MAX_WIDTH=2200
IMAGE_MAX_HEIGHT=2200
IMAGE_MIN_QUALITY=55
IMAGE_START_QUALITY=88
```

---

## 10. Almacenamiento en MinIO

MinIO reemplaza completamente a Google Drive.

### Bucket sugerido

```text
remitos
```

### Estructura lógica de objetos

```text
remitos/
├── originals/
│   └── 2026/08/{source_file_uuid}/archivo-original.ext
├── optimized/
│   └── 2026/08/{source_file_uuid}/archivo-optimizado.jpg
└── previews/
    └── 2026/08/{source_file_uuid}/preview.webp
```

No es necesario depender del nombre del cliente para ubicar físicamente el archivo. La relación cliente/remito debe vivir en PostgreSQL.

Esto evita mover objetos cada vez que se corrige el nombre o número de cliente.

### Acceso

El bucket debe permanecer privado.

La aplicación entregará archivos mediante:

- URL prefirmada de MinIO con expiración corta, o
- endpoint FastAPI autorizado que entregue el archivo.

Nunca debe exponerse públicamente el bucket completo.

---

## 11. Modelo de procesamiento

### Estados de `source_files`

```text
uploaded
pending
processing
processed
requires_review
partial
error
duplicate
```

### Flujo

```text
uploaded
  ↓
pending
  ↓
processing
  ├─→ processed
  ├─→ requires_review
  ├─→ partial
  ├─→ duplicate
  └─→ error
```

### Significado

- `uploaded`: archivo recibido y almacenado.
- `pending`: preparado para OCR.
- `processing`: OCR en ejecución.
- `processed`: todos los datos requeridos fueron procesados correctamente.
- `requires_review`: hay campos dudosos o nulos que requieren intervención.
- `partial`: el archivo contenía varios remitos y alguno falló o quedó incompleto.
- `duplicate`: archivo/remito ya existente según reglas de deduplicación.
- `error`: fallo técnico durante procesamiento.

---

## 12. Procesamiento de uno o varios remitos

La respuesta del OCR es siempre un array.

Esto permite:

- una imagen con un remito;
- una imagen donde se vean varios remitos;
- un PDF de una página;
- un PDF de varias páginas;
- archivos procesados en lote.

Ejemplo:

```json
[
  {
    "cliente": "CONSORCIO EDIF KALEM",
    "numero_cliente": "12299",
    "fecha_hora": "22/06/2026 10:35",
    "numero_remito": "B 5001 00139455",
    "comentarios": "OBRA TORRE 2"
  },
  {
    "cliente": "CONSORCIO EDIF KALEM",
    "numero_cliente": "12299",
    "fecha_hora": "22/06/2026 11:10",
    "numero_remito": "B 5001 00139595",
    "comentarios": null
  }
]
```

---

## 13. Validación del resultado OCR

### Contrato Pydantic sugerido

```python
from pydantic import BaseModel

class OCRDeliveryNote(BaseModel):
    cliente: str | None = None
    numero_cliente: str | None = None
    fecha_hora: str | None = None
    numero_remito: str | None = None
    comentarios: str | None = None
```

### Reglas

- No aceptar claves adicionales del modelo.
- Convertir valores vacíos a `null`.
- `numero_cliente` siempre string.
- `numero_remito` siempre string.
- Validar `fecha_hora` con formato `DD/MM/YYYY HH:mm` cuando no sea null.
- No eliminar espacios internos de `numero_remito`.
- No eliminar ceros iniciales.
- No intentar completar datos ausentes mediante heurísticas no verificables.

### Criterio de revisión

Un remito debe quedar en `requires_review` si ocurre al menos una de estas condiciones:

- `numero_remito == null`;
- `numero_cliente == null`;
- `cliente == null`;
- `fecha_hora == null`;
- la fecha/hora no tiene formato válido;
- el modelo devuelve una estructura inválida;
- existe ambigüedad evidente durante validaciones posteriores.

`comentarios` puede ser `null` sin bloquear el procesamiento.

---

## 14. Prevención de duplicados

Se utilizarán dos niveles de control.

### Nivel 1 — Archivo idéntico

Calcular SHA-256 del archivo recibido.

```text
UNIQUE source_files.sha256
```

Si el mismo archivo vuelve a cargarse, se marca como duplicado sin volver a ejecutar OCR salvo acción explícita de reprocesamiento.

### Nivel 2 — Remito repetido

Una vez obtenido el OCR:

```text
numero_cliente + numero_remito
```

puede utilizarse como clave funcional para detectar un remito ya existente.

No debe eliminarse automáticamente un duplicado: debe quedar registrado para revisión/auditoría.

---

## 15. Modelo de datos

### Tabla `source_files`

```sql
CREATE TABLE source_files (
    id UUID PRIMARY KEY,
    original_filename TEXT NOT NULL,
    mime_type VARCHAR(100) NOT NULL,
    original_size_bytes BIGINT NOT NULL,
    optimized_size_bytes BIGINT,
    sha256 CHAR(64) NOT NULL UNIQUE,

    minio_original_key TEXT,
    minio_optimized_key TEXT,
    minio_preview_key TEXT,

    status VARCHAR(30) NOT NULL DEFAULT 'uploaded',
    detected_remitos INTEGER NOT NULL DEFAULT 0,
    attempts INTEGER NOT NULL DEFAULT 0,
    error_message TEXT,

    uploaded_by UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    processed_at TIMESTAMPTZ
);
```

### Tabla `delivery_notes`

```sql
CREATE TABLE delivery_notes (
    id UUID PRIMARY KEY,
    source_file_id UUID NOT NULL REFERENCES source_files(id),

    cliente TEXT,
    numero_cliente VARCHAR(100),
    fecha_hora TIMESTAMPTZ,
    numero_remito VARCHAR(150),
    comentarios TEXT,

    page_number INTEGER,
    detection_index INTEGER,

    status VARCHAR(30) NOT NULL DEFAULT 'processed',
    extraction_payload JSONB,

    manually_reviewed BOOLEAN NOT NULL DEFAULT FALSE,
    reviewed_by UUID,
    reviewed_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### Índices sugeridos

```sql
CREATE INDEX idx_delivery_notes_numero_remito
ON delivery_notes(numero_remito);

CREATE INDEX idx_delivery_notes_numero_cliente
ON delivery_notes(numero_cliente);

CREATE INDEX idx_delivery_notes_cliente
ON delivery_notes(cliente);

CREATE INDEX idx_delivery_notes_fecha_hora
ON delivery_notes(fecha_hora);

CREATE INDEX idx_delivery_notes_status
ON delivery_notes(status);
```

Para búsquedas por texto parcial del cliente puede agregarse `pg_trgm` posteriormente.

---

## 16. Backend FastAPI

FastAPI concentra toda la lógica del sistema.

### Responsabilidades

- autenticación;
- recepción de uploads;
- validación de MIME/tamaño;
- cálculo de hashes;
- procesamiento de imágenes;
- compresión;
- integración MinIO;
- integración Gemini;
- parseo y validación del JSON;
- persistencia en PostgreSQL;
- deduplicación;
- búsqueda;
- filtros;
- URLs temporales para archivos;
- corrección manual;
- reprocesamiento;
- auditoría básica.

### Módulos sugeridos

```text
backend/
├── app/
│   ├── api/
│   │   ├── auth.py
│   │   ├── uploads.py
│   │   ├── remitos.py
│   │   └── files.py
│   ├── core/
│   │   ├── config.py
│   │   └── security.py
│   ├── models/
│   ├── schemas/
│   ├── repositories/
│   ├── services/
│   │   ├── minio_service.py
│   │   ├── image_service.py
│   │   ├── pdf_service.py
│   │   ├── ocr_service.py
│   │   ├── extraction_service.py
│   │   └── duplicate_service.py
│   └── main.py
└── tests/
```

---

## 17. Endpoints principales

### Upload

```http
POST /api/v1/uploads
```

`multipart/form-data`, uno o varios archivos.

Respuesta inicial:

```json
{
  "files": [
    {
      "id": "uuid",
      "filename": "remito-1.jpg",
      "status": "pending"
    }
  ]
}
```

### Estado de procesamiento

```http
GET /api/v1/uploads/{source_file_id}
```

### Remitos

```http
GET    /api/v1/remitos
GET    /api/v1/remitos/{id}
PATCH  /api/v1/remitos/{id}
POST   /api/v1/remitos/{id}/approve
POST   /api/v1/remitos/{id}/reprocess
```

### Archivo

```http
GET /api/v1/remitos/{id}/file-url
```

Devuelve una URL prefirmada temporal.

### Reprocesamiento de archivo completo

```http
POST /api/v1/uploads/{source_file_id}/reprocess
```

---

## 18. Frontend React

### Pantalla 1 — Dashboard

Mostrar:

- total de remitos;
- procesados;
- pendientes;
- en revisión;
- errores;
- duplicados.

### Pantalla 2 — Remitos

Tabla con:

| Estado | Fecha y hora | N.º remito | N.º cliente | Cliente | Comentarios | Archivo |
|---|---|---|---|---|---|---|

Funciones:

- buscar;
- ordenar;
- filtrar;
- paginar;
- abrir detalle;
- ver documento.

### Búsqueda

Por:

- `numero_remito`;
- `numero_cliente`;
- `cliente`;
- `fecha_hora`;
- `comentarios`.

### Pantalla 3 — Detalle

Diseño recomendado en desktop:

```text
┌────────────────────────┬──────────────────────────┐
│                        │ Cliente                  │
│                        │ Número cliente           │
│   Preview documento    │ Fecha / hora             │
│                        │ Número remito            │
│                        │ Comentarios              │
│                        │ Estado                   │
│                        │                          │
│                        │ [Editar] [Aprobar]       │
└────────────────────────┴──────────────────────────┘
```

En mobile se apila verticalmente.

### Pantalla 4 — Escanear / subir

Desktop:

- drag & drop;
- selector múltiple;
- listado de archivos elegidos;
- progreso de subida/procesamiento.

Mobile:

- botón **Sacar foto**;
- botón **Elegir archivo**;
- galería temporal de capturas;
- agregar más;
- eliminar captura;
- procesar lote.

### Pantalla 5 — Revisión

Mostrar lado a lado:

- documento;
- valores detectados;
- campos editables;
- botón aprobar.

---

## 19. Procesamiento asíncrono

Aunque se elimina n8n, el OCR no debería bloquear la petición HTTP durante cargas múltiples.

### MVP

Puede implementarse una cola simple controlada por aplicación utilizando PostgreSQL y un worker Python independiente dentro del mismo proyecto.

```text
FastAPI recibe upload
      ↓
source_files.status = pending
      ↓
worker Python toma pendientes
      ↓
processing
      ↓
Gemini + persistencia
      ↓
processed / requires_review / error
```

Esto sigue siendo una solución **100 % código**, sin depender de n8n.

### Evolución futura

Si el volumen aumenta:

- Redis;
- Celery / Dramatiq / RQ;
- múltiples workers.

No es obligatorio para la primera versión.

---

## 20. Integración con Gemini

### Modelo

```env
OCR_MODEL=gemini-3.5-flash
```

Debe configurarse por variable de entorno para poder reemplazar el modelo sin modificar lógica de negocio.

### Servicio

`ocr_service.py` debe encargarse exclusivamente de:

1. recibir el documento o representación de imagen;
2. construir la solicitud al modelo;
3. aplicar el prompt definido;
4. obtener texto/respuesta estructurada;
5. entregar el resultado bruto a `extraction_service.py`.

### Separación de responsabilidades

```text
ocr_service
   ↓ salida cruda
extraction_service
   ↓ JSON normalizado / validado
repository
   ↓ PostgreSQL
```

Esto permite cambiar Gemini por otro proveedor en el futuro sin reescribir el resto del sistema.

---

## 21. PDF

### PDF de una página

- almacenar PDF;
- generar preview;
- renderizar página a imagen para OCR cuando sea necesario;
- crear remito(s) según respuesta.

### PDF multipágina

- renderizar cada página para análisis o enviar el PDF directamente si el proveedor/modelo lo soporta adecuadamente;
- mantener `page_number` cuando pueda determinarse;
- el resultado final sigue siendo un array de remitos.

### Librerías sugeridas

```text
PyMuPDF
Pillow
```

---

## 22. Seguridad

### MinIO

- bucket privado;
- credenciales solo en backend;
- nunca exponer Access Key/Secret Key al frontend;
- URLs prefirmadas con vencimiento.

### Uploads

- lista blanca de MIME types;
- límite de tamaño;
- validar extensión y contenido;
- nombre físico generado por UUID;
- nunca confiar en el nombre original como path.

### API

- autenticación;
- autorización para endpoints de administración;
- CORS restringido al dominio correspondiente;
- rate limiting si se expone públicamente.

---

## 23. Variables de entorno sugeridas

```env
APP_ENV=production
DATABASE_URL=postgresql+asyncpg://...

MINIO_ENDPOINT=minio.example.com
MINIO_ACCESS_KEY=...
MINIO_SECRET_KEY=...
MINIO_BUCKET=remitos
MINIO_SECURE=true
MINIO_PRESIGNED_EXPIRES_SECONDS=900

GEMINI_API_KEY=...
OCR_MODEL=gemini-3.5-flash
OCR_TIMEOUT_SECONDS=120
OCR_MAX_RETRIES=3

TARGET_IMAGE_SIZE_KB=300
IMAGE_MAX_WIDTH=2200
IMAGE_MAX_HEIGHT=2200
IMAGE_START_QUALITY=88
IMAGE_MIN_QUALITY=55

MAX_UPLOAD_MB=25
PROCESSING_BATCH_SIZE=3
MAX_CONCURRENT_OCR=3
```

---

## 24. Despliegue

El sistema debe poder desplegarse como un único stack Docker Compose.

### Servicios

```text
frontend
backend
worker
postgres
minio
```

Opcionalmente:

```text
reverse-proxy / traefik
```

Ejemplo conceptual:

```text
Docker Compose
├── frontend (React)
├── api (FastAPI)
├── worker (Python)
├── postgres
└── minio
```

Todos forman parte del mismo stack aunque sean contenedores independientes.

Esto facilita:

- instalación en servidor propio;
- migración a infraestructura del cliente;
- backups;
- actualización;
- replicación del entorno.

---

## 25. Backups

Deben contemplarse dos fuentes de datos:

### PostgreSQL

Backup periódico de:

- remitos;
- usuarios;
- estados;
- metadata;
- auditoría.

### MinIO

Backup de:

- originales;
- optimizados;
- previews.

La base de datos y MinIO deben respaldarse de manera coordinada para evitar registros apuntando a archivos inexistentes.

---

## 26. Pruebas obligatorias

### Carga

- una imagen;
- varias imágenes;
- PDF;
- PDF multipágina;
- archivo inválido;
- archivo muy grande.

### Mobile

- captura desde Android;
- captura desde iPhone;
- múltiples fotografías consecutivas;
- rotación vertical/horizontal;
- imagen tomada con poca luz;
- imagen inclinada.

### OCR

- todos los campos legibles;
- `comentarios` presente;
- `comentarios` vacío;
- número de remito con prefijo completo;
- número de cliente con ceros iniciales;
- fecha/hora ilegible;
- múltiples remitos visibles;
- ningún remito visible;
- salida inválida del modelo.

### Duplicados

- mismo archivo dos veces;
- distinta foto del mismo remito;
- mismo `numero_cliente + numero_remito`.

### MinIO

- upload correcto;
- objeto inexistente;
- URL prefirmada expirada;
- caída temporal de MinIO.

### Fallos

- timeout Gemini;
- error 5xx del proveedor;
- reinicio del worker;
- reinicio de FastAPI durante procesamiento.

---

## 27. Criterios de aceptación

El MVP se considera funcional cuando:

1. El usuario puede acceder desde desktop y mobile al mismo dominio.
2. Puede subir una o varias imágenes/PDF.
3. Desde mobile puede sacar fotografías desde la plataforma.
4. Las imágenes son optimizadas buscando aproximadamente 300 KB sin degradar el OCR de manera inaceptable.
5. Los documentos quedan almacenados en MinIO privado.
6. No se utiliza Google Drive.
7. El procesamiento principal no depende de n8n.
8. FastAPI/Python gestiona el flujo completo.
9. Gemini recibe el documento y devuelve un array de remitos.
10. Por cada remito se extraen exclusivamente:
    - cliente;
    - numero_cliente;
    - fecha_hora;
    - numero_remito;
    - comentarios.
11. `numero_remito` conserva el identificador completo.
12. `numero_cliente` y `numero_remito` permanecen como strings.
13. Los ceros iniciales se conservan.
14. `fecha_hora` se normaliza a `DD/MM/YYYY HH:mm`.
15. Los datos quedan almacenados en PostgreSQL.
16. El usuario puede buscar por los cinco campos.
17. Puede abrir el archivo desde el detalle del remito.
18. Puede corregir manualmente campos erróneos.
19. Un dato dudoso no es inventado: se almacena como `null` y puede pasar a revisión.
20. Los archivos duplicados no se reprocesan innecesariamente.
21. Los errores de OCR pueden reintentarse.
22. El sistema puede instalarse mediante Docker Compose como un único stack.

---

## 28. Plan de implementación

### Fase 1 — Infraestructura base

- FastAPI.
- PostgreSQL.
- MinIO.
- configuración Docker Compose.
- modelos y migraciones.
- servicio de almacenamiento.

### Fase 2 — Upload y procesamiento de imágenes

- endpoint de carga múltiple;
- hash SHA-256;
- validación MIME;
- optimización a objetivo ~300 KB;
- almacenamiento MinIO;
- previews.

### Fase 3 — OCR

- integración Gemini;
- prompt definitivo de cinco campos;
- parseo seguro;
- schema Pydantic;
- validaciones;
- persistencia.

### Fase 4 — Worker

- cola simple basada en PostgreSQL;
- estados;
- reintentos;
- concurrencia limitada.

### Fase 5 — Frontend desktop

- dashboard;
- tabla;
- buscador;
- filtros;
- detalle;
- preview;
- revisión manual.

### Fase 6 — Mobile responsive

- flujo sacar foto;
- carga múltiple;
- miniaturas;
- progreso;
- experiencia táctil.

### Fase 7 — Calidad

- casos reales de remitos;
- análisis de 20–30 documentos distintos;
- ajuste de prompt;
- validación del modelo OCR definitivo;
- pruebas de compresión y legibilidad.

---

## 29. Decisiones que deben poder cambiar sin reescribir el sistema

La implementación debe mantener configurables:

- modelo OCR;
- proveedor OCR;
- tamaño objetivo de imagen;
- concurrencia;
- cantidad de reintentos;
- bucket MinIO;
- tiempo de expiración de URLs;
- límites de upload.

El dominio de negocio no debe depender directamente del SDK de Gemini ni del SDK de MinIO.

---

## 30. Arquitectura final resumida

```text
                    ┌──────────────────────┐
                    │ React Web Responsive │
                    │ Desktop + Mobile     │
                    └──────────┬───────────┘
                               │
                               ▼
                    ┌──────────────────────┐
                    │ FastAPI / Python     │
                    │ API + negocio        │
                    └──────┬───────┬───────┘
                           │       │
                  metadata│       │archivos
                           ▼       ▼
                  ┌────────────┐  ┌────────────┐
                  │ PostgreSQL │  │   MinIO    │
                  └─────┬──────┘  └────────────┘
                        │
                        │ trabajos pendientes
                        ▼
                  ┌────────────┐
                  │ Worker Py  │
                  └─────┬──────┘
                        │
                        ▼
                  ┌────────────┐
                  │ Gemini OCR │
                  └────────────┘
```

### Stack final

```text
React
FastAPI
Python
PostgreSQL
MinIO
Gemini 3.5 Flash
Docker Compose
```

Sin Google Drive y sin n8n en el flujo principal.

---

## 31. Resultado esperado

El producto final debe sentirse como una plataforma propia de digitalización de remitos, no como una automatización conectada a servicios externos de almacenamiento.

El usuario entra al sistema, sube o fotografía sus documentos, el sistema los optimiza, almacena, analiza y organiza automáticamente, y luego puede buscar cualquier remito desde una interfaz simple utilizando sus datos principales.

La arquitectura queda preparada además para ser desplegada tanto en infraestructura administrada por el proveedor como en un servidor del cliente mediante el mismo stack Docker Compose.
