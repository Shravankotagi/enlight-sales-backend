import { ChatbotTool, CallerContext } from './chatbot-tool.interface';

export const searchKnowledgeBaseTool: ChatbotTool = {
  name: 'search_knowledge_base',
  description:
    'Searches the Enlight Sales OS Knowledge Base (SOPs, product catalogs, sales policies, and guidelines) with role-based access filtering.',
  roles: ['salesperson', 'manager', 'admin'],
  declaration: {
    name: 'search_knowledge_base',
    description:
      'Searches company Knowledge Base documents (SOPs, product specifications, policies, and guidelines) relevant to the query.',
    parameters: {
      type: 'OBJECT',
      properties: {
        query: {
          type: 'STRING',
          description:
            'The search query or topic to look up in the Knowledge Base.',
        },
      },
      required: ['query'],
    },
  },
  async execute(args: any, callerContext: CallerContext, supabaseAdmin: any) {
    const queryText = (args?.query || '').trim();
    if (!queryText) {
      return { data: { message: 'Query parameter is required' }, rowCount: 0 };
    }

    // 1. Generate query embedding using gemini-embedding-001 (task_type=RETRIEVAL_QUERY)
    const apiKey =
      process.env.GEMINI_API_KEY ||
      process.env.GEMINI_API_KEY_1 ||
      process.env.GEMINI_API_KEY_2 ||
      process.env.GEMINI_API_KEY_3;

    if (!apiKey) {
      throw new Error('Gemini API key is not configured');
    }

    const modelName =
      process.env.GEMINI_EMBEDDING_MODEL || 'gemini-embedding-001';
    let queryEmbedding: number[] = [];
    try {
      const { GoogleGenAI } = await import('@google/genai');
      const ai = new GoogleGenAI({ apiKey });

      const response: any = await ai.models.embedContent({
        model: modelName,
        contents: queryText,
        config: { taskType: 'RETRIEVAL_QUERY', outputDimensionality: 768 },
      });

      let values =
        response?.embedding?.values || response?.embeddings?.[0]?.values;
      if (values && values.length > 0) {
        if (values.length > 768) values = values.slice(0, 768);
        queryEmbedding = values;
      }
    } catch (err: any) {
      // Fallback to LangChain generative embeddings if primary SDK call fails
      const { GoogleGenerativeAIEmbeddings } =
        await import('@langchain/google-genai');
      const embeddings = new GoogleGenerativeAIEmbeddings({
        model: modelName,
        apiKey: apiKey,
      });
      const raw = await embeddings.embedQuery(queryText);
      queryEmbedding = raw.length > 768 ? raw.slice(0, 768) : raw;
      if (err?.message) {
        // preserve err reference for linter
      }
    }

    if (!queryEmbedding || queryEmbedding.length === 0) {
      throw new Error('Failed to generate query vector embedding');
    }

    // 2. Map caller.role to allowed visibility roles (Layer 1 RBAC scoping)
    let allowedRoles: string[] = ['all'];
    if (callerContext.role === 'salesperson') {
      allowedRoles = ['all', 'salesperson'];
    } else if (callerContext.role === 'manager') {
      allowedRoles = ['all', 'salesperson', 'manager', 'manager_plus'];
    } else if (callerContext.role === 'admin') {
      allowedRoles = [
        'all',
        'salesperson',
        'manager',
        'manager_plus',
        'admin',
        'admin_only',
      ];
    }

    // 3. Vector Similarity Search via Postgres RPC match_kb_chunks
    const { data: chunks, error } = await supabaseAdmin.rpc('match_kb_chunks', {
      query_embedding: JSON.stringify(queryEmbedding),
      match_count: 5,
      allowed_roles: allowedRoles,
    });

    if (error) {
      throw new Error(`match_kb_chunks RPC error: ${error.message}`);
    }

    const chunkList = chunks || [];
    const formattedChunks = chunkList.map((c: any) => ({
      document_title: c.title,
      visibility_role: c.visibility_role,
      similarity_score: Math.round((c.similarity || 0) * 100) / 100,
      content: c.content,
    }));

    return {
      data: {
        query: queryText,
        results_found: formattedChunks.length,
        chunks: formattedChunks,
      },
      rowCount: formattedChunks.length,
    };
  },
};
