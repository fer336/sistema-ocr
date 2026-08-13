import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { StatusBadge } from "../components/StatusBadge";
import { cn } from "../lib/cn";
import { getUploadStatus, reprocessUpload, uploadFiles } from "../lib/api";
import { SOURCE_FILE_STATUS, TERMINAL_SOURCE_FILE_STATUS, type SourceFile } from "../types";

/** Coincide con `MAX_UPLOAD_MB` de PRD §23. */
const MAX_UPLOAD_MB = 25;
const ACCEPTED_MIME_PREFIXES = ["image/"];
const ACCEPTED_MIME_TYPES = ["application/pdf"];

const POLL_INTERVAL_MS = 2000;
/**
 * 900 × 2s = 30 minutos.
 *
 * El tope anterior (90 = ~3 min) daba por perdido un archivo que el worker
 * seguía procesando: el backend no se entera de que el frontend dejó de
 * mirar, así que cortar el poll solo rompía la vista, no el trabajo. 30 min es
 * un techo generoso para un pico de latencia de Gemini o una cola larga; si se
 * alcanza, el archivo igual termina y aparece en el listado.
 */
const POLL_MAX_ATTEMPTS = 900;

/**
 * Duración típica del OCR, usada SOLO para estimar la barra de progreso.
 *
 * No es un dato que reporte el backend: el OCR es una única llamada a Gemini
 * sin sub-pasos, así que no hay progreso real que consultar. La barra avanza
 * por tiempo transcurrido y se topea en 95% hasta que llega el estado terminal.
 * Ajustar si en producción el promedio real se corre.
 */
const AVG_PROCESSING_MS = 10_000;
const PROGRESS_TICK_MS = 500;
const PROGRESS_CEILING = 95;

/**
 * Archivos en vuelo (`source_file_id` → `startedAt`) persistidos para sobrevivir
 * a un desmontaje: si el usuario navega a otra pantalla y vuelve, se retoma el
 * poll y el porcentaje sigue reflejando el tiempo real transcurrido en vez de
 * reiniciarse. El worker nunca se detuvo; lo que se recupera es la vista.
 */
const IN_FLIGHT_STORAGE_KEY = "sanitini.uploads.in-flight";
/** Más allá de esto la entrada es basura vieja: se descarta al restaurar. */
const IN_FLIGHT_MAX_AGE_MS = POLL_INTERVAL_MS * POLL_MAX_ATTEMPTS;

/**
 * Estados terminales del backend donde tiene sentido ofrecer el override
 * explícito de PRD §14 ("...sin volver a ejecutar OCR salvo acción explícita de
 * reprocesamiento"): el archivo YA existe en la base, así que volver a subirlo
 * rebotaría por el dedup de sha256. El camino correcto es
 * `POST /uploads/{id}/reprocess`.
 *
 * `requires_review`/`partial` quedan afuera a propósito: esos se corrigen a
 * mano en la pantalla de Revisión, y reprocesar borraría las correcciones.
 */
const REPROCESSABLE_SERVER_STATUS: readonly string[] = [
  SOURCE_FILE_STATUS.DUPLICATE,
  SOURCE_FILE_STATUS.ERROR,
];

type StageStatus = "staged" | "uploading" | "processing" | "done" | "failed";

interface StagedFile {
  key: string;
  /**
   * `null` cuando la fila se restauró de `localStorage`: un `File` no es
   * serializable. Esas filas siempre tienen `sourceFileId`, así que el único
   * camino que necesitan (reintentar = `/reprocess`) sigue disponible.
   */
  file: File | null;
  filename: string;
  sizeBytes: number | null;
  /** `URL.createObjectURL` para la miniatura; null para PDF o filas restauradas. */
  objectUrl: string | null;
  stage: StageStatus;
  sourceFileId: string | null;
  /** `source_files.status` devuelto por el backend. */
  serverStatus: string | null;
  detectedRemitos: number | null;
  message: string | null;
  /** Timestamp del arranque del procesamiento; base del porcentaje estimado. */
  startedAt: number | null;
  /** 0-100 estimado por tiempo transcurrido (ver `AVG_PROCESSING_MS`). */
  progress: number;
}

function isAccepted(file: File): boolean {
  return (
    ACCEPTED_MIME_PREFIXES.some((prefix) => file.type.startsWith(prefix)) ||
    ACCEPTED_MIME_TYPES.includes(file.type)
  );
}

function stageFile(file: File): StagedFile {
  return {
    key: crypto.randomUUID(),
    file,
    filename: file.name,
    sizeBytes: file.size,
    objectUrl: file.type.startsWith("image/") ? URL.createObjectURL(file) : null,
    stage: "staged",
    sourceFileId: null,
    serverStatus: null,
    detectedRemitos: null,
    message: null,
    startedAt: null,
    progress: 0,
  };
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Porcentaje estimado: nunca llega a 100 sin confirmación del backend. */
function estimateProgress(startedAt: number | null): number {
  if (startedAt === null) return 0;
  const elapsed = Date.now() - startedAt;
  return Math.min(PROGRESS_CEILING, (elapsed / AVG_PROCESSING_MS) * 100);
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/* ------------------------------------------------- persistencia de "en vuelo" */

interface TrackedUpload {
  /**
   * Identidad estable de la fila, independiente del `sourceFileId`: durante
   * la subida (`stage: "uploading"`) todavía no existe un `sourceFileId` --
   * si no hubiera una clave propia, esa ventana quedaría sin forma de
   * trackearse en absoluto (ver `sourceFileId: null` más abajo).
   */
  clientKey: string;
  /**
   * `null` mientras el binario todavía viaja al backend. Si la pestaña se
   * mata en ese momento (navegación dura, la app en background la descarta
   * en el celular), no hay nada que retomar -- el `File` no sobrevive a un
   * remount -- pero al menos queda registro de que algo se perdió, en vez de
   * desaparecer sin dejar rastro.
   */
  sourceFileId: string | null;
  filename: string;
  startedAt: number;
}

function readTrackedUploads(): TrackedUpload[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(IN_FLIGHT_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const now = Date.now();
    return parsed.filter((item): item is TrackedUpload => {
      if (typeof item !== "object" || item === null) return false;
      const entry = item as Partial<TrackedUpload>;
      return (
        typeof entry.clientKey === "string" &&
        (entry.sourceFileId === null || typeof entry.sourceFileId === "string") &&
        typeof entry.filename === "string" &&
        typeof entry.startedAt === "number" &&
        now - entry.startedAt < IN_FLIGHT_MAX_AGE_MS
      );
    });
  } catch {
    // localStorage lleno, deshabilitado o con basura: no es motivo para romper
    // la pantalla, se sigue sin persistencia.
    return [];
  }
}

function writeTrackedUploads(entries: TrackedUpload[]): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(IN_FLIGHT_STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // Ídem: la persistencia es una mejora, no un requisito del flujo.
  }
}

function trackUpload(entry: TrackedUpload): void {
  const others = readTrackedUploads().filter((item) => item.clientKey !== entry.clientKey);
  writeTrackedUploads([...others, entry]);
}

function untrackUpload(clientKey: string): void {
  writeTrackedUploads(readTrackedUploads().filter((item) => item.clientKey !== clientKey));
}

/**
 * Filas reconstruidas desde `localStorage` al montar la pantalla.
 *
 * `key` reusa el `clientKey` persistido (no uno nuevo): así `resumeTracked`
 * y `removeFile` pueden seguir llamando a `untrackUpload(staged.key)` sin
 * tener que cargar un mapeo aparte entre la fila reconstruida y su entrada
 * original en `localStorage`.
 */
function restoreInFlightFiles(): StagedFile[] {
  return readTrackedUploads().map((entry) =>
    entry.sourceFileId !== null
      ? {
          key: entry.clientKey,
          file: null,
          filename: entry.filename,
          sizeBytes: null,
          objectUrl: null,
          stage: "processing" as StageStatus,
          sourceFileId: entry.sourceFileId,
          serverStatus: SOURCE_FILE_STATUS.PROCESSING,
          detectedRemitos: null,
          message: null,
          startedAt: entry.startedAt,
          progress: estimateProgress(entry.startedAt),
        }
      : {
          key: entry.clientKey,
          file: null,
          filename: entry.filename,
          sizeBytes: null,
          objectUrl: null,
          stage: "failed" as StageStatus,
          sourceFileId: null,
          serverStatus: null,
          detectedRemitos: null,
          message:
            "La subida se interrumpió antes de llegar al servidor (se cerró o recargó la pestaña). Volvé a seleccionar el archivo.",
          startedAt: entry.startedAt,
          progress: 0,
        }
  );
}

/**
 * Pantalla 4 de PRD §18 / flujo de PRD §8.
 *
 * Nada se envía al backend hasta "Procesar remitos": antes de eso los archivos
 * viven solo en el cliente (miniaturas, agregar más, eliminar).
 */
export function Upload() {
  // Inicializador perezoso: las filas en vuelo de una visita anterior a esta
  // pantalla se restauran ANTES del primer render, así el usuario que vuelve no
  // ve la lista vacía por un frame.
  const [files, setFiles] = useState<StagedFile[]>(restoreInFlightFiles);
  const [rejected, setRejected] = useState<string[]>([]);
  const [processing, setProcessing] = useState(false);
  const [dragging, setDragging] = useState(false);

  const cameraInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const objectUrlsRef = useRef<string[]>([]);
  const cancelledRef = useRef(false);
  const resumedRef = useRef(false);
  /** Snapshot del primer render = exactamente lo restaurado de `localStorage`. */
  const restoredFilesRef = useRef(files);

  useEffect(() => {
    // Hay que rearmarlo en el setup, no sólo limpiarlo en el cleanup: en
    // StrictMode React monta → desmonta → remonta, y si el flag quedara en
    // `true` la pantalla nacería "cancelada" (el lote cortaría en el primer
    // archivo y `processing` se quedaría trabado en true para siempre).
    cancelledRef.current = false;

    // Retomar el poll de lo que quedó en vuelo. `resumedRef` evita duplicarlo
    // en el doble montaje de StrictMode; los loops del primer montaje siguen
    // vivos porque el flag de cancelación se resetea justo arriba.
    if (!resumedRef.current) {
      resumedRef.current = true;
      for (const restored of restoredFilesRef.current) {
        if (restored.sourceFileId) {
          void resumeTracked(restored.key, restored.sourceFileId);
        } else {
          // Subida interrumpida (ver `restoreInFlightFiles`): ya se mostró
          // el mensaje, no queda nada que retomar.
          untrackUpload(restored.key);
        }
      }
    }

    return () => {
      cancelledRef.current = true;
      for (const url of objectUrlsRef.current) URL.revokeObjectURL(url);
      objectUrlsRef.current = [];
    };
  }, []);

  const hasInFlight = files.some(
    (item) => item.stage === "uploading" || item.stage === "processing"
  );

  // Recalcula el porcentaje estimado mientras haya algo en vuelo. Va aparte del
  // poll (cada 2s) para que la barra se mueva de forma fluida.
  useEffect(() => {
    if (!hasInFlight) return;
    const intervalId = setInterval(() => {
      setFiles((current) =>
        current.map((item) =>
          item.stage === "uploading" || item.stage === "processing"
            ? { ...item, progress: estimateProgress(item.startedAt) }
            : item
        )
      );
    }, PROGRESS_TICK_MS);
    return () => clearInterval(intervalId);
  }, [hasInFlight]);

  function addFiles(incoming: FileList | null) {
    if (!incoming || incoming.length === 0) return;

    const accepted: StagedFile[] = [];
    const problems: string[] = [];

    for (const file of Array.from(incoming)) {
      if (!isAccepted(file)) {
        problems.push(`${file.name}: formato no admitido.`);
        continue;
      }
      if (file.size > MAX_UPLOAD_MB * 1024 * 1024) {
        problems.push(`${file.name}: supera ${MAX_UPLOAD_MB} MB.`);
        continue;
      }
      const staged = stageFile(file);
      if (staged.objectUrl) objectUrlsRef.current.push(staged.objectUrl);
      accepted.push(staged);
    }

    if (accepted.length > 0) setFiles((current) => [...current, ...accepted]);
    setRejected(problems);
  }

  function removeFile(key: string) {
    setFiles((current) => {
      const target = current.find((item) => item.key === key);
      if (target?.objectUrl) {
        URL.revokeObjectURL(target.objectUrl);
        objectUrlsRef.current = objectUrlsRef.current.filter((url) => url !== target.objectUrl);
      }
      // Sacarlo de la vista también lo saca del tracking persistido: si no, la
      // fila reaparecería sola al volver a entrar a la pantalla. Se llama
      // siempre (no solo con `sourceFileId`): una subida interrumpida queda
      // trackeada por `key` sin tener todavía un `sourceFileId`.
      untrackUpload(key);
      return current.filter((item) => item.key !== key);
    });
  }

  function patchFile(key: string, patch: Partial<StagedFile>) {
    setFiles((current) =>
      current.map((item) => (item.key === key ? { ...item, ...patch } : item))
    );
  }

  /**
   * `"cancelled"` (el componente se desmontó, ej. el usuario navegó a otra
   * pantalla) y `"timeout"` (se agotó `POLL_MAX_ATTEMPTS` con el backend
   * todavía procesando) tienen que distinguirse: solo el segundo caso es un
   * abandono real. Antes ambos devolvían `null` y `settle` los trataba
   * igual -- eso hacía que CUALQUIER cambio de pantalla mid-proceso
   * desmarcara el archivo de `localStorage` (`untrackUpload`), perdiendo el
   * único rastro que permitía retomarlo al volver. El worker nunca se
   * enteraba de nada: el archivo seguía procesándose bien en el servidor,
   * solo la vista lo daba por perdido.
   */
  async function pollUntilTerminal(
    sourceFileId: string
  ): Promise<SourceFile | "cancelled" | "timeout"> {
    for (let attempt = 0; attempt < POLL_MAX_ATTEMPTS; attempt += 1) {
      await delay(POLL_INTERVAL_MS);
      if (cancelledRef.current) return "cancelled";
      const state = await getUploadStatus(sourceFileId);
      if (TERMINAL_SOURCE_FILE_STATUS.includes(state.status)) return state;
    }
    return "timeout";
  }

  /**
   * Retoma el poll de un archivo restaurado de `localStorage`. Si ya terminó
   * mientras la pantalla estaba desmontada, el primer `getUploadStatus` lo
   * resuelve sin esperar un ciclo entero.
   */
  async function resumeTracked(key: string, sourceFileId: string) {
    try {
      const state = await getUploadStatus(sourceFileId);
      if (cancelledRef.current) return;
      await settle(key, sourceFileId, state.status);
    } catch (err) {
      untrackUpload(key);
      if (cancelledRef.current) return;
      patchFile(key, { stage: "failed", message: (err as Error).message });
    }
  }

  async function processOne(staged: StagedFile) {
    // Reintento de un archivo que ya llegó al backend: se reprocesa por id.
    // Volver a subirlo chocaría con el dedup por sha256 (PRD §14 nivel 1) y
    // devolvería `duplicate` en vez de reintentar el OCR.
    if (staged.sourceFileId) {
      const startedAt = Date.now();
      patchFile(staged.key, { stage: "processing", message: null, startedAt, progress: 0 });
      trackUpload({
        clientKey: staged.key,
        sourceFileId: staged.sourceFileId,
        filename: staged.filename,
        startedAt,
      });
      const state = await reprocessUpload(staged.sourceFileId);
      await settle(staged.key, staged.sourceFileId, state.status);
      return;
    }

    if (!staged.file) {
      throw new Error("El archivo original ya no está disponible; volvé a subirlo.");
    }

    const uploadStartedAt = Date.now();
    patchFile(staged.key, {
      stage: "uploading",
      message: null,
      startedAt: uploadStartedAt,
      progress: 0,
    });
    // Trackeado ANTES del POST, con `sourceFileId: null`: si la pestaña se
    // mata mientras el binario todavía viaja (subida grande, conexión
    // móvil lenta), `restoreInFlightFiles` puede avisar que se perdió en
    // vez de que la fila desaparezca sin dejar rastro -- que es exactamente
    // lo que pasaba antes de este cambio.
    trackUpload({
      clientKey: staged.key,
      sourceFileId: null,
      filename: staged.filename,
      startedAt: uploadStartedAt,
    });

    let response;
    try {
      response = await uploadFiles([staged.file]);
    } catch (err) {
      untrackUpload(staged.key);
      throw err;
    }
    const uploaded = response.files?.[0];
    if (!uploaded) {
      untrackUpload(staged.key);
      throw new Error("El backend no devolvió el archivo subido.");
    }

    // Rechazo en la validación del upload (MIME, tamaño, fallo de MinIO): no se
    // creó ninguna fila en `source_files` y el `id` que viene es descartable.
    // No lo guardamos: reintentar tiene que volver a SUBIR el archivo, no pegarle
    // a `/reprocess` con un id que no existe (404). Como tampoco quedó sha256
    // registrado, el reintento no choca con el dedup nivel 1 (PRD §14).
    if (uploaded.status === SOURCE_FILE_STATUS.ERROR) {
      untrackUpload(staged.key);
      patchFile(staged.key, {
        stage: "failed",
        serverStatus: uploaded.status,
        message: uploaded.error ?? "El backend rechazó el archivo.",
      });
      return;
    }

    // El OCR arranca acá: `startedAt` se reinicia para que el porcentaje no
    // arrastre el tiempo que tardó la subida del binario.
    const startedAt = Date.now();
    patchFile(staged.key, {
      stage: "processing",
      sourceFileId: uploaded.id,
      serverStatus: uploaded.status,
      message: uploaded.error ?? null,
      startedAt,
      progress: 0,
    });
    if (TERMINAL_SOURCE_FILE_STATUS.includes(uploaded.status)) {
      untrackUpload(staged.key);
    } else {
      // Mismo `clientKey`: pisa la entrada `sourceFileId: null` de arriba en
      // vez de duplicarla (`trackUpload` dedupea por `clientKey`).
      trackUpload({
        clientKey: staged.key,
        sourceFileId: uploaded.id,
        filename: staged.filename,
        startedAt,
      });
    }

    await settle(staged.key, uploaded.id, uploaded.status);
  }

  /** Espera el estado terminal del archivo y refleja el resultado. */
  async function settle(key: string, sourceFileId: string, currentStatus: string) {
    // `duplicate` (dedup nivel 1) llega ya resuelto: no hay OCR que esperar.
    if (TERMINAL_SOURCE_FILE_STATUS.includes(currentStatus)) {
      untrackUpload(key);
      patchFile(key, { stage: "done", serverStatus: currentStatus, progress: 100 });
      return;
    }

    const result = await pollUntilTerminal(sourceFileId);

    if (result === "cancelled") {
      // El componente se desmontó -- NO se toca `localStorage`. El archivo
      // sigue tracked a propósito: cuando el usuario vuelva a "Escanear",
      // `restoreInFlightFiles` lo retoma donde quedó, en vez de perderlo.
      return;
    }

    if (result === "timeout") {
      // Acá sí es un abandono real: 30 min sin estado terminal con la
      // pantalla activa y mirando. Dejamos de trackear para no revivir esta
      // fila sola en el próximo montaje.
      untrackUpload(key);
      patchFile(key, {
        stage: "failed",
        message: "El procesamiento sigue en curso. Consultá el listado más tarde.",
      });
      return;
    }

    untrackUpload(key);
    patchFile(key, {
      stage: "done",
      serverStatus: result.status,
      detectedRemitos: result.detected_remitos ?? null,
      message: result.error_message,
      // El backend confirmó estado terminal: recién ahí la barra salta a 100%.
      progress: 100,
    });
  }

  /**
   * Override explícito del dedup nivel 1 (PRD §14). El backend devolvió el id
   * del `source_file` que ya tenía este sha256, así que reprocesamos ESE
   * archivo en vez de intentar subir el mismo binario otra vez.
   */
  async function handleReprocess(staged: StagedFile) {
    const sourceFileId = staged.sourceFileId;
    if (!sourceFileId) return;

    setProcessing(true);
    try {
      const startedAt = Date.now();
      patchFile(staged.key, { stage: "processing", message: null, startedAt, progress: 0 });
      trackUpload({ clientKey: staged.key, sourceFileId, filename: staged.filename, startedAt });
      const state = await reprocessUpload(sourceFileId);
      await settle(staged.key, sourceFileId, state.status);
    } catch (err) {
      patchFile(staged.key, { stage: "failed", message: (err as Error).message });
    } finally {
      if (!cancelledRef.current) setProcessing(false);
    }
  }

  async function handleProcess() {
    setProcessing(true);
    const pending = files.filter((item) => item.stage === "staged" || item.stage === "failed");

    for (const staged of pending) {
      if (cancelledRef.current) break;
      try {
        await processOne(staged);
      } catch (err) {
        patchFile(staged.key, { stage: "failed", message: (err as Error).message });
      }
    }

    if (!cancelledRef.current) setProcessing(false);
  }

  const pendingCount = files.filter(
    (item) => item.stage === "staged" || item.stage === "failed"
  ).length;
  const doneCount = files.filter((item) => item.stage === "done").length;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-ink">Escanear remitos</h2>
        <p className="text-sm text-ink-muted">
          Sacá una foto o elegí archivos. Nada se envía hasta que toques “Procesar remitos”.
        </p>
      </div>

      {/* PRD §8.A — `capture="environment"` fuerza la cámara trasera. Va en un
          input aparte: si lo pusiéramos en el mismo input de archivos, el
          navegador no dejaría elegir de la galería. */}
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        multiple
        className="hidden"
        onChange={(event) => {
          addFiles(event.target.files);
          event.target.value = "";
        }}
      />
      {/* PRD §8.B — galería / archivos / PDF, sin `capture`. */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,application/pdf"
        multiple
        className="hidden"
        onChange={(event) => {
          addFiles(event.target.files);
          event.target.value = "";
        }}
      />

      <div
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          addFiles(event.dataTransfer.files);
        }}
        className={cn(
          "rounded-lg border-2 border-dashed p-6 text-center transition",
          dragging ? "border-primary bg-primary/5" : "border-border bg-surface"
        )}
      >
        <p className="hidden text-sm text-ink-muted md:block">
          Arrastrá archivos acá o usá los botones.
        </p>
        <div className="mt-0 flex flex-col gap-2 sm:flex-row sm:justify-center md:mt-4">
          <button
            type="button"
            onClick={() => cameraInputRef.current?.click()}
            className="rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-white transition hover:bg-primary-hover"
          >
            Sacar foto
          </button>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="rounded-lg border border-border bg-surface px-4 py-2.5 text-sm font-medium text-ink transition hover:bg-surface-raised"
          >
            Elegir archivo
          </button>
        </div>
        <p className="mt-3 text-xs text-ink-muted">
          Imágenes o PDF, hasta {MAX_UPLOAD_MB} MB por archivo.
        </p>
      </div>

      {rejected.length > 0 && (
        <ul className="rounded-lg border border-warning/30 bg-warning-soft px-4 py-3 text-sm text-warning">
          {rejected.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      )}

      {files.length > 0 && (
        <>
          <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {files.map((staged) => (
              <li
                key={staged.key}
                className="flex flex-col overflow-hidden rounded-lg border border-border bg-surface"
              >
                <div className="flex h-32 items-center justify-center bg-surface-raised">
                  {/* Sin `file` la fila viene de `localStorage`: no hay binario
                      local para hacer miniatura ni para saber si era PDF. */}
                  {staged.objectUrl ? (
                    <img
                      src={staged.objectUrl}
                      alt={staged.filename}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <span className="text-sm font-medium text-ink-muted">
                      {staged.file ? "PDF" : "Archivo"}
                    </span>
                  )}
                </div>
                <div className="flex flex-1 flex-col gap-1 p-3">
                  <p className="truncate text-sm font-medium text-ink" title={staged.filename}>
                    {staged.filename}
                  </p>
                  {staged.sizeBytes !== null && (
                    <p className="text-xs text-ink-muted">{formatSize(staged.sizeBytes)}</p>
                  )}

                  <StageIndicator staged={staged} />

                  {staged.message && (
                    <p className="text-xs break-words text-error">{staged.message}</p>
                  )}

                  <div className="mt-auto flex flex-wrap items-center gap-3 pt-1">
                    {staged.stage === "done" &&
                      staged.sourceFileId &&
                      REPROCESSABLE_SERVER_STATUS.includes(staged.serverStatus ?? "") && (
                        <button
                          type="button"
                          onClick={() => void handleReprocess(staged)}
                          disabled={processing}
                          className="text-xs font-medium text-primary hover:underline disabled:opacity-50"
                        >
                          Procesar igual
                        </button>
                      )}
                    {staged.stage !== "uploading" && staged.stage !== "processing" && (
                      <button
                        type="button"
                        onClick={() => removeFile(staged.key)}
                        className="text-xs font-medium text-error hover:underline"
                      >
                        Quitar de la lista
                      </button>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => void handleProcess()}
              disabled={processing || pendingCount === 0}
              className="rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-white transition hover:bg-primary-hover disabled:opacity-50"
            >
              {processing ? "Procesando..." : `Procesar remitos (${pendingCount})`}
            </button>
            {doneCount > 0 && (
              <Link
                to="/remitos"
                className="rounded-lg border border-border bg-surface px-4 py-2 text-sm font-medium text-ink transition hover:bg-surface-raised"
              >
                Ver remitos
              </Link>
            )}
            {!processing && files.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  for (const url of objectUrlsRef.current) URL.revokeObjectURL(url);
                  objectUrlsRef.current = [];
                  for (const item of files) untrackUpload(item.key);
                  setFiles([]);
                  setRejected([]);
                }}
                className="text-sm font-medium text-ink-muted hover:text-ink hover:underline"
              >
                Limpiar lista
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function StageIndicator({ staged }: { staged: StagedFile }) {
  if (staged.stage === "staged") {
    return <span className="text-xs text-ink-muted">Listo para enviar</span>;
  }

  if (staged.stage === "uploading" || staged.stage === "processing") {
    const percent = Math.round(staged.progress);
    return (
      <div className="space-y-1">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-ink-muted">
            {staged.stage === "uploading" ? "Subiendo..." : "Procesando OCR..."}
          </span>
          <span className="text-xs tabular-nums text-ink-muted">{percent}%</span>
        </div>
        <div
          className="h-1.5 w-full overflow-hidden rounded-full bg-surface-raised"
          role="progressbar"
          aria-valuenow={percent}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          {/* Ancho dinámico: no hay clase de Tailwind para un porcentaje libre. */}
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-500 ease-linear"
            style={{ width: `${percent}%` }}
          />
        </div>
      </div>
    );
  }

  if (staged.stage === "failed") {
    return <StatusBadge status={SOURCE_FILE_STATUS.ERROR} />;
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <StatusBadge status={staged.serverStatus ?? SOURCE_FILE_STATUS.PROCESSED} />
      {staged.detectedRemitos !== null && (
        <span className="text-xs text-ink-muted">
          {staged.detectedRemitos} remito{staged.detectedRemitos === 1 ? "" : "s"}
        </span>
      )}
    </div>
  );
}
