import { logRoleName, welcomeEmail } from './employees.service';

describe('admin log role names', () => {
  it('uses the dashboard name for a custom role id', () => {
    expect(logRoleName('role_test_salesperson_4705', 'test_salesperson')).toBe(
      'test_salesperson',
    );
    expect(logRoleName('role_test_salesperson_4705')).toBe('test_salesperson');
    expect(logRoleName('salesperson')).toBe('Salesperson');
  });

  it('fills the welcome email for an invited user', () => {
    const mail = welcomeEmail({
      name: 'Shravan Kotagi',
      email: 'shravan@example.com',
      phone: '+918262937458',
      role: 'Sales Manager',
      loginUrl: 'https://app.enlightmetals.com',
    });
    expect(mail.subject).toBe('Welcome to Enlight Sigma');
    expect(mail.text).toContain('Hi Shravan Kotagi,');
    expect(mail.text).toContain('shravan@example.com');
    expect(mail.text).toContain('+918262937458');
    expect(mail.text).toContain('Sales Manager');
    expect(mail.html).toContain('https://app.enlightmetals.com');
    expect(mail.html).toContain('cid:enlight-logo');
    expect(mail.html.indexOf('Best Regards')).toBeLessThan(
      mail.html.indexOf('cid:enlight-logo'),
    );
  });
});
