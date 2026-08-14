export interface CallerContext {
  userId: string;
  email: string;
  role: 'salesperson' | 'manager' | 'admin';
  employeeId?: string;
  phone?: string;
  reportsToId?: string;
  name?: string;
}

export interface ChatbotTool<TArgs = any, TResult = any> {
  name: string;
  description: string;
  declaration: {
    name: string;
    description: string;
    parameters: any;
  };
  roles: ('salesperson' | 'manager' | 'admin')[];
  execute(
    args: TArgs,
    callerContext: CallerContext,
    supabaseAdmin: any,
  ): Promise<{ data: TResult; rowCount: number }>;
}
