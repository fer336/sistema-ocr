import re

_DIGIT_GROUPS_RE = re.compile(r"\d+")


def normalize_document_number(value: str | None) -> str | None:
    """Normaliza un número de remito al formato canónico "B 5001 00123456".

    El modelo a veces transcribe el número con guiones ("5001-00139454"), sin
    el prefijo "B" o incluso sin el prefijo "5001" ("00139913"). Esta función:

    - extrae todos los grupos de dígitos del string (p.ej. con
      re.findall(r"\\d+", value)) y los junta como dígitos contiguos, que es
      como aparecen en el documento impreso;
    - busca la secuencia que empieza con "5001" seguida del número impreso
      (el patrón canónico es "5001" + 6 o más dígitos, 10 dígitos en total
      comenzando con "5001");
    - si la encuentra, devuelve "B 5001 " + los dígitos del número impreso.

    Si NO matchea el patrón (por ejemplo cuando el modelo omitió el "5001"),
    devuelve el string original sin espacios al inicio/fin: preferimos
    conservar el dato tal cual —y que la confianza quede a criterio de la
    revisión manual— antes que perderlo devolviendo None.
    """
    if not value:
        return None
    stripped = value.strip()
    groups = _DIGIT_GROUPS_RE.findall(stripped)
    for index, group in enumerate(groups):
        if not group.startswith("5001"):
            continue
        tail = group[4:]
        if not tail and index + 1 < len(groups):
            tail = groups[index + 1]
        if tail:
            return f"B 5001 {tail}"
        break
    return stripped
