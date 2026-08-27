-- REQ-017's case-insensitive partial-match name search (`ILIKE '%query%'`)
-- can't use a standard B-tree index (a leading wildcard defeats it), which
-- would force a sequential scan and violate database-architect.md's <50ms
-- target as the patient list grows. See
-- .kiro/specs/phase-1b-patients/design.md's "Search needs a trigram index"
-- section.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX "patients_full_name_trgm_idx" ON "patients" USING gin ("fullName" gin_trgm_ops);
