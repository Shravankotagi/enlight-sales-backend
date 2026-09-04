export interface CallerContext {
  userId: string;
  email: string;
  role: 'salesperson' | 'manager' | 'sales_manager' | 'admin' | string;
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
  roles: ('salesperson' | 'manager' | 'sales_manager' | 'admin' | string)[];
  execute(
    args: TArgs,
    callerContext: CallerContext,
    supabaseAdmin: any,
  ): Promise<{ data: TResult; rowCount: number }>;
}

export function isManagerRole(role?: string): boolean {
  if (!role) return false;
  const r = role.toLowerCase();
  return r === 'manager' || r === 'sales_manager';
}

export function isSalespersonRole(role?: string): boolean {
  if (!role) return false;
  const r = role.toLowerCase();
  return r === 'salesperson' || r === 'sales_rep';
}

export function isAdminRole(role?: string): boolean {
  if (!role) return false;
  return role.toLowerCase() === 'admin';
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
      'id, employee_id, phone, name, manager_id, manager_phone, reports_to_employee_id, role',
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
      ].filter(Boolean),
    ),
  ) as string[];

  const phones = Array.from(
    new Set(matched.map((m: any) => m.phone).filter(Boolean)),
  ) as string[];

  const phoneSuffixes = Array.from(
    new Set(
      matched
        .map((m: any) => (m.phone || '').replace(/\D/g, '').slice(-10))
        .filter((p: string) => p && p.length === 10),
    ),
  ) as string[];

  return { employeeIds, phones, phoneSuffixes };
}

export interface CustomerAccessVerification {
  allowed: boolean;
  isAssignedToCaller: boolean;
  existsInSystem: boolean;
  message?: string;
}

/**
 * Checks whether the caller is authorized to view data for a specific customer or company name.
 * Prevents cross-salesperson data leakage (e.g. Salesperson A querying Salesperson B's account).
 */
export async function verifyCustomerAccountAccess(
  customerName: string,
  callerContext: CallerContext,
  supabaseAdmin: any,
): Promise<CustomerAccessVerification> {
  const target = (customerName || '').trim().toLowerCase();
  if (!target) {
    return { allowed: true, isAssignedToCaller: true, existsInSystem: false };
  }

  // Admin has global access to all customers
  if (isAdminRole(callerContext.role)) {
    return { allowed: true, isAssignedToCaller: true, existsInSystem: true };
  }

  // 1. Resolve authorized phone suffixes and employee IDs
  const rawPhone = callerContext.phone || '';
  const cleanPhone = rawPhone.replace(/\D/g, '').slice(-10);
  const empId = callerContext.employeeId;

  let authorizedPhoneSuffixes: string[] = [];
  let authorizedEmployeeIds: string[] = [];

  if (isSalespersonRole(callerContext.role)) {
    if (!cleanPhone && !empId) {
      return {
        allowed: false,
        isAssignedToCaller: false,
        existsInSystem: false,
        message: 'Access denied. Caller identity could not be verified.',
      };
    }
    if (cleanPhone) authorizedPhoneSuffixes.push(cleanPhone);
    if (empId) authorizedEmployeeIds.push(empId);
  } else if (isManagerRole(callerContext.role)) {
    const sub = await getSubordinateSalespersons(callerContext, supabaseAdmin);
    authorizedPhoneSuffixes = sub.phoneSuffixes;
    authorizedEmployeeIds = sub.employeeIds;
    if (
      authorizedPhoneSuffixes.length === 0 &&
      authorizedEmployeeIds.length === 0
    ) {
      return {
        allowed: false,
        isAssignedToCaller: false,
        existsInSystem: false,
        message: `You do not have any company like "${customerName}" in your assigned accounts.`,
      };
    }
  }

  const isPhoneAuth = (phoneToCheck?: string | null): boolean => {
    if (!phoneToCheck) return false;
    const clean = phoneToCheck.replace(/\D/g, '').slice(-10);
    if (!clean) return false;
    return authorizedPhoneSuffixes.some((p) => clean.includes(p));
  };

  const isEmpAuth = (empIdToCheck?: string | null): boolean => {
    if (!empIdToCheck) return false;
    return authorizedEmployeeIds.includes(empIdToCheck);
  };

  // 2. Query global database across recurring_customers, deals, customer_visits, and complaints matching target
  const [
    { data: globalRecurring },
    { data: globalDeals },
    { data: globalVisits },
    { data: globalComplaints },
  ] = await Promise.all([
    supabaseAdmin
      .from('recurring_customers')
      .select('customer_name, assigned_salesperson_phone')
      .ilike('customer_name', `%${target}%`),
    supabaseAdmin
      .from('deals')
      .select('customer_name, salesperson_phone, employee_id')
      .ilike('customer_name', `%${target}%`),
    supabaseAdmin
      .from('customer_visits')
      .select('customer_name, salesperson_phone, employee_id')
      .ilike('customer_name', `%${target}%`),
    supabaseAdmin
      .from('complaints')
      .select('customer_name, reported_by, employee_id')
      .ilike('customer_name', `%${target}%`),
  ]);

  const allMatches: {
    name: string;
    phone?: string | null;
    empId?: string | null;
  }[] = [
    ...(globalRecurring || []).map((r: any) => ({
      name: r.customer_name,
      phone: r.assigned_salesperson_phone,
      empId: null,
    })),
    ...(globalDeals || []).map((d: any) => ({
      name: d.customer_name,
      phone: d.salesperson_phone,
      empId: d.employee_id,
    })),
    ...(globalVisits || []).map((v: any) => ({
      name: v.customer_name,
      phone: v.salesperson_phone,
      empId: v.employee_id,
    })),
    ...(globalComplaints || []).map((c: any) => ({
      name: c.customer_name,
      phone: c.reported_by,
      empId: c.employee_id,
    })),
  ];

  // 3. Exact match check (case-insensitive trimmed string)
  const exactMatches = allMatches.filter(
    (m) => m.name && m.name.trim().toLowerCase() === target,
  );

  if (exactMatches.length > 0) {
    const callerHasExact = exactMatches.some(
      (m) => isPhoneAuth(m.phone) || isEmpAuth(m.empId),
    );

    if (!callerHasExact) {
      // The exact company exists in the system but belongs to another salesperson!
      return {
        allowed: false,
        isAssignedToCaller: false,
        existsInSystem: true,
        message: `You do not have any company like "${customerName}" in your assigned accounts.`,
      };
    }
    return { allowed: true, isAssignedToCaller: true, existsInSystem: true };
  }

  // 4. If no exact match, check if ANY partial match in the system belongs to caller
  if (allMatches.length > 0) {
    const callerHasAny = allMatches.some(
      (m) => isPhoneAuth(m.phone) || isEmpAuth(m.empId),
    );

    if (!callerHasAny) {
      // All matching accounts belong to other salespersons!
      return {
        allowed: false,
        isAssignedToCaller: false,
        existsInSystem: true,
        message: `You do not have any company like "${customerName}" in your assigned accounts.`,
      };
    }
    return { allowed: true, isAssignedToCaller: true, existsInSystem: true };
  }

  // 5. If no records exist in the system at all, caller does not have this account
  return {
    allowed: false,
    isAssignedToCaller: false,
    existsInSystem: false,
    message: `You do not have any company like "${customerName}" in your assigned accounts.`,
  };
}
