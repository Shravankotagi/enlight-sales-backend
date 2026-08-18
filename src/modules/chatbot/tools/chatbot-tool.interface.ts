export interface CallerContext {
  userId: string;
  email: string;
  role: 'salesperson' | 'manager' | 'admin';
  employeeId?: string;
  phone?: string;
  reportsToId?: string;
  name?: string;
  allUserIds?: string[];
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

/**
 * Resolves all subordinate salespersons reporting to a manager via manager_id, manager_phone, or reports_to_employee_id.
 */
export async function getSubordinateSalespersons(
  callerContext: CallerContext,
  supabaseAdmin: any,
): Promise<{
  employeeIds: string[];
  phones: string[];
  phoneSuffixes: string[];
}> {
  const normPhone = (callerContext.phone || '').replace(/\D/g, '');
  const last10 = normPhone.slice(-10);

  const { data: allActive } = await supabaseAdmin
    .from('employees')
    .select(
      'id, employee_id, phone, name, manager_id, manager_phone, reports_to_employee_id',
    )
    .eq('is_active', true);

  const matched = (allActive || []).filter((emp: any) => {
    const r = (emp.role || '').toLowerCase();
    if (r.includes('admin') || r.includes('manager')) return false;
    if (callerContext.userId && emp.manager_id === callerContext.userId)
      return true;
    if (
      callerContext.employeeId &&
      (emp.manager_id === callerContext.employeeId ||
        emp.reports_to_employee_id === callerContext.employeeId)
    )
      return true;
    if (
      last10 &&
      emp.manager_phone &&
      emp.manager_phone.replace(/\D/g, '').includes(last10)
    )
      return true;
    return false;
  });

  const employeeIds = Array.from(
    new Set(
      [
        ...matched.map((m: any) => m.id),
        ...matched.map((m: any) => m.employee_id),
        callerContext.userId,
        callerContext.employeeId,
      ].filter(Boolean),
    ),
  ) as string[];

  const phones = Array.from(
    new Set(
      [...matched.map((m: any) => m.phone), callerContext.phone].filter(
        Boolean,
      ),
    ),
  ) as string[];

  const phoneSuffixes = Array.from(
    new Set(
      [
        ...matched.map((m: any) =>
          (m.phone || '').replace(/\D/g, '').slice(-10),
        ),
        last10,
      ].filter((p) => p && p.length === 10),
    ),
  ) as string[];

  return { employeeIds, phones, phoneSuffixes };
}
