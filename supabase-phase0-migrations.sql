-- Enlight Sales OS Chatbot - Phase 0 Migration Script
-- Run this script in the Supabase SQL Editor or via migration pipeline

-- 1. Enable pgvector extension for knowledge base embeddings
CREATE EXTENSION IF NOT EXISTS vector;

-- 2. Add reporting lines and WhatsApp verification timestamp to employees
ALTER TABLE employees 
  ADD COLUMN IF NOT EXISTS reports_to_employee_id uuid REFERENCES employees(id),
  ADD COLUMN IF NOT EXISTS whatsapp_verified_at timestamptz;

-- 3. Create chat_sessions table to track web and WhatsApp conversations
CREATE TABLE IF NOT EXISTS chat_sessions (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id text NOT NULL,
  channel text DEFAULT 'web', -- 'web' | 'whatsapp'
  external_thread_id text,
  started_at timestamptz DEFAULT now(),
  last_active_at timestamptz DEFAULT now()
);

-- 4. Create chat_messages table to store conversation history and function calls
CREATE TABLE IF NOT EXISTS chat_messages (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id uuid REFERENCES chat_sessions(id) ON DELETE CASCADE,
  role text NOT NULL, -- 'user' | 'assistant' | 'system' | 'tool'
  content text,
  function_call jsonb,
  function_result jsonb,
  created_at timestamptz DEFAULT now()
);

-- 5. Create kb_documents table for Knowledge Base source documents
CREATE TABLE IF NOT EXISTS kb_documents (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  title text NOT NULL,
  source_file_url text,
  visibility_role text DEFAULT 'all', -- 'all' | 'manager_plus' | 'admin_only'
  uploaded_by text NOT NULL,
  version integer DEFAULT 1,
  updated_at timestamptz DEFAULT now()
);

-- 6. Create kb_chunks table with 768-dimension vector and HNSW index
CREATE TABLE IF NOT EXISTS kb_chunks (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  doc_id uuid REFERENCES kb_documents(id) ON DELETE CASCADE,
  content text NOT NULL,
  embedding vector(768),
  token_count integer,
  metadata jsonb,
  created_at timestamptz DEFAULT now()
);

-- Create HNSW index on kb_chunks embedding column for fast cosine distance search
CREATE INDEX IF NOT EXISTS kb_chunks_embedding_hnsw_idx 
  ON kb_chunks USING hnsw (embedding vector_cosine_ops);

-- 7. Create audit_log table for tracking tool usage and writes
CREATE TABLE IF NOT EXISTS audit_log (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id text,
  tool_name text,
  args jsonb,
  row_count integer,
  details jsonb,
  created_at timestamptz DEFAULT now()
);

-- 8. Backfill Template for Pilot Group Reporting Lines
-- Example backfill query to link sales representatives to their Sales Manager
-- UPDATE employees 
-- SET reports_to_employee_id = (SELECT id FROM employees WHERE role = 'manager' LIMIT 1)
-- WHERE role = 'salesperson' AND reports_to_employee_id IS NULL;
