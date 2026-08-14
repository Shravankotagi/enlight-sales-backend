-- Enlight Sales OS Chatbot — Phase 3 Knowledge Base Vector Search RPC & RLS Migration

-- 1. Create or replace match_kb_chunks RPC function for cosine similarity vector search
CREATE OR REPLACE FUNCTION match_kb_chunks(
  query_embedding vector(768),
  match_count int DEFAULT 5,
  allowed_roles text[] DEFAULT ARRAY['all']
)
RETURNS TABLE (
  id uuid,
  doc_id uuid,
  content text,
  metadata jsonb,
  title text,
  visibility_role text,
  similarity float
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    c.id,
    c.doc_id,
    c.content,
    c.metadata,
    d.title,
    d.visibility_role,
    (1 - (c.embedding <=> query_embedding))::float AS similarity
  FROM kb_chunks c
  JOIN kb_documents d ON c.doc_id = d.id
  WHERE d.visibility_role = ANY(allowed_roles)
  ORDER BY c.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- 2. Enable RLS on kb_documents and kb_chunks
ALTER TABLE kb_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE kb_chunks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS kb_documents_role_policy ON kb_documents;
DROP POLICY IF EXISTS kb_chunks_role_policy ON kb_chunks;

CREATE POLICY kb_documents_role_policy ON kb_documents
  FOR ALL
  USING (
    (current_setting('request.jwt.claims', true)::jsonb ->> 'role') = 'admin'
    OR
    visibility_role = 'all'
    OR
    (visibility_role IN ('salesperson', 'all') AND (current_setting('request.jwt.claims', true)::jsonb ->> 'role') IN ('salesperson', 'manager', 'admin'))
    OR
    (visibility_role IN ('manager', 'manager_plus', 'salesperson', 'all') AND (current_setting('request.jwt.claims', true)::jsonb ->> 'role') IN ('manager', 'admin'))
  );

CREATE POLICY kb_chunks_role_policy ON kb_chunks
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM kb_documents d WHERE d.id = kb_chunks.doc_id
    )
  );
