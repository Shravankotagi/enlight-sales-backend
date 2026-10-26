export interface CallerContext {
  userId: string;
  email: string;
  role: 'salesperson' | 'manager' | 'sales_manager' | 'admin' | string;
  employeeId?: string;
  phone?: string;
  reportsToId?: string;
  name?: string;
  allUserIds?: string[];
  permissions?: Record<string, boolean>;
  dataScope?: 'own' | 'team' | 'all';
}
