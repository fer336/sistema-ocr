"""Worker de procesamiento OCR (PRD §19).

Cola simple sobre PostgreSQL: `source_files.status='pending'` es la cola y
`claim_pending` (SELECT ... FOR UPDATE SKIP LOCKED) es el take atómico. Sin
Redis ni broker externo, y sin n8n.
"""
