import {
  mergePermissions,
  normalizeRoleId,
  legacyDataScope,
  BUILTIN_ROLE_TEMPLATES,
} from './permissionKeys';

describe('permission merge', () => {
  it('maps a legacy manager role onto sales_manager', () => {
    expect(normalizeRoleId('manager')).toBe('sales_manager');
    expect(legacyDataScope('manager')).toBe('team');
  });

  it('lets a personal override replace the role value', () => {
    const merged = mergePermissions(BUILTIN_ROLE_TEMPLATES.salesperson, {
      'visits.update': true,
      'not.a.key': true,
    });
    expect(merged['visits.update']).toBe(true);
    expect(merged['not.a.key']).toBeUndefined();
    expect(merged['visits.delete']).toBe(false);
  });

  it('does not give a salesperson admin staff access', () => {
    expect(BUILTIN_ROLE_TEMPLATES.salesperson['staff.manage_acl']).toBe(false);
    expect(BUILTIN_ROLE_TEMPLATES.admin['staff.manage_acl']).toBe(true);
    expect(BUILTIN_ROLE_TEMPLATES.admin['customers.scope_assigned']).toBe(
      false,
    );
  });
});
