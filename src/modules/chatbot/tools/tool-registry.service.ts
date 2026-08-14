import {
  Injectable,
  Logger,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseService } from '../../../infrastructure/supabase/supabase.service';
import { ChatbotTool, CallerContext } from './chatbot-tool.interface';
import { getMyOpenDealsTool } from './get_my_open_deals.tool';
import { getCustomer360Tool } from './get_customer_360.tool';
import { getReorderQueueTool } from './get_reorder_queue.tool';
import { searchKnowledgeBaseTool } from './search_knowledge_base.tool';

@Injectable()
export class ToolRegistryService {
  private readonly logger = new Logger(ToolRegistryService.name);
  private readonly toolsMap = new Map<string, ChatbotTool>();

  constructor(private readonly supabaseService: SupabaseService) {
    this.registerTool(getMyOpenDealsTool);
    this.registerTool(getCustomer360Tool);
    this.registerTool(getReorderQueueTool);
    this.registerTool(searchKnowledgeBaseTool);
  }

  registerTool(tool: ChatbotTool) {
    this.toolsMap.set(tool.name, tool);
    this.logger.log(
      `Registered chatbot tool: ${tool.name} (allowed roles: ${tool.roles.join(', ')})`,
    );
  }

  /**
   * Returns Gemini FunctionDeclarations filtered by caller role.
   * Format matches Gemini FunctionDeclaration specification.
   */
  getToolDeclarations(role: 'salesperson' | 'manager' | 'admin'): any[] {
    const declarations: any[] = [];
    for (const tool of this.toolsMap.values()) {
      if (tool.roles.includes(role)) {
        declarations.push(tool.declaration);
      }
    }
    return declarations;
  }

  /**
   * Executes a tool with server-injected callerContext and logs the invocation to audit_log.
   */
  async executeTool(
    name: string,
    args: any,
    callerContext: CallerContext,
  ): Promise<any> {
    const tool = this.toolsMap.get(name);
    if (!tool) {
      this.logger.error(`Attempted to execute unknown tool: ${name}`);
      throw new NotFoundException(`Tool '${name}' not found`);
    }

    // Role visibility check (Layer 1 application check)
    if (!tool.roles.includes(callerContext.role)) {
      this.logger.warn(
        `RBAC Violation Attempt: User ${callerContext.userId} (${callerContext.role}) attempted to execute tool '${name}'`,
      );
      throw new ForbiddenException(
        `Role '${callerContext.role}' is not authorized to use tool '${name}'`,
      );
    }

    this.logger.log(
      `Executing tool '${name}' for user ${callerContext.email || callerContext.userId} (${callerContext.role})`,
    );

    const supabaseAdmin = this.supabaseService.getAdminClient();

    // Execute tool with server-injected callerContext
    const result = await tool.execute(args, callerContext, supabaseAdmin);

    // Audit Logging (Rule 7: Every tool call logs to audit_log)
    try {
      await supabaseAdmin.from('audit_log').insert({
        user_id: callerContext.userId,
        tool_name: name,
        args: args || {},
        row_count: result.rowCount,
        details: {
          role: callerContext.role,
          employee_id: callerContext.employeeId,
          phone: callerContext.phone,
        },
        created_at: new Date().toISOString(),
      });
    } catch (auditErr: any) {
      this.logger.error(
        `Failed to write audit_log for tool '${name}':`,
        auditErr.message,
      );
    }

    return result.data;
  }
}
