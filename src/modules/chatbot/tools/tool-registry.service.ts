import {
  Injectable,
  Logger,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseService } from '../../../infrastructure/supabase/supabase.service';
import { ChatbotTool, CallerContext } from './chatbot-tool.interface';
import { getMyOpenDealsTool } from './get_my_open_deals.tool';
import { getInquiriesTool } from './get_inquiries.tool';
import { getCustomer360Tool } from './get_customer_360.tool';
import { getReorderQueueTool } from './get_reorder_queue.tool';
import { searchKnowledgeBaseTool } from './search_knowledge_base.tool';
import { getTeamPipelineTool } from './get_team_pipeline.tool';
import { getChurnRadarTool } from './get_churn_radar.tool';
import { getLossAnalyticsTool } from './get_loss_analytics.tool';
import { getVisitsTool } from './get_visits.tool';
import { getComplaintsTool } from './get_complaints.tool';

@Injectable()
export class ToolRegistryService {
  private readonly logger = new Logger(ToolRegistryService.name);
  private readonly toolsMap = new Map<string, ChatbotTool>();

  constructor(private readonly supabaseService: SupabaseService) {
    this.registerTool(getInquiriesTool);
    this.registerTool(getMyOpenDealsTool);
    this.registerTool(getCustomer360Tool);
    this.registerTool(getReorderQueueTool);
    this.registerTool(searchKnowledgeBaseTool);
    this.registerTool(getTeamPipelineTool);
    this.registerTool(getChurnRadarTool);
    this.registerTool(getLossAnalyticsTool);
    this.registerTool(getVisitsTool);
    this.registerTool(getComplaintsTool);
  }

  registerTool(tool: ChatbotTool) {
    this.toolsMap.set(tool.name, tool);
    this.logger.log(
      `Registered chatbot tool: ${tool.name} (allowed roles: ${tool.roles.join(', ')})`,
    );
  }

  /**
   * Returns Gemini FunctionDeclarations filtered by caller role.
   */
  getToolDeclarations(role: string): any[] {
    const declarations: any[] = [];
    for (const tool of this.toolsMap.values()) {
      const allowed =
        tool.roles.includes(role) ||
        (role === 'sales_manager' && tool.roles.includes('manager')) ||
        (role === 'manager' && tool.roles.includes('sales_manager'));
      if (allowed) {
        declarations.push(tool.declaration);
      }
    }
    return declarations;
  }

  /**
   * Executes a tool with server-injected callerContext, wraps output in untrusted content tags, and logs to audit_log.
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
    const isAllowed =
      tool.roles.includes(callerContext.role) ||
      (callerContext.role === 'sales_manager' &&
        tool.roles.includes('manager')) ||
      (callerContext.role === 'manager' &&
        tool.roles.includes('sales_manager'));

    if (!isAllowed) {
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

    // Audit Logging
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

    // Explicit "Untrusted Content" wrapping for tool output data
    const rawDataStr =
      typeof result.data === 'string'
        ? result.data
        : JSON.stringify(result.data, null, 2);
    return `<untrusted_content source="tool:${name}">\n${rawDataStr}\n</untrusted_content>`;
  }
}
