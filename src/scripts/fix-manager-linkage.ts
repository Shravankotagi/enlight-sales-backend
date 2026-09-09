import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });
dotenv.config({ path: path.resolve(process.cwd(), '../.env') });

async function fixManagerLinkage() {
  const { SupabaseService } =
    await import('../infrastructure/supabase/supabase.service');
  const { ConfigService } = await import('../config/config.service');
  const { ConfigService: NestConfigService } = await import('@nestjs/config');

  const configService = new ConfigService(new NestConfigService());
  const supabaseService = new SupabaseService(configService);
  const supabase = supabaseService.getAdminClient();

  console.log('--- Step 1: Finding Sales Manager John ---');
  const { data: managers, error: mgrErr } = await supabase
    .from('employees')
    .select('*')
    .or('phone.eq.917878787878,employee_id.eq.EMP007');

  if (mgrErr || !managers || managers.length === 0) {
    console.error('Could not find John:', mgrErr);
    return;
  }
  const john = managers[0];
  console.log(
    `Found Manager: ${john.name} (ID: ${john.id}, EMP: ${john.employee_id}, Phone: ${john.phone})`,
  );

  console.log('\n--- Step 2: Updating Rishabh Makwana manager linkage ---');
  const { data: updatedRishabh, error: updateErr } = await supabase
    .from('employees')
    .update({
      manager_id: john.id,
      manager_phone: john.phone,
      reports_to_employee_id: john.id,
    })
    .eq('id', '48d888a3-a2bd-4169-aba3-a93b71035cf6')
    .select();

  if (updateErr) {
    console.error('Failed to update Rishabh:', updateErr);
  } else {
    console.log('Updated Rishabh Makwana successfully:', updatedRishabh);
  }

  console.log('\n--- Step 3: Verifying all salespersons under John ---');
  const { data: team, error: teamErr } = await supabase
    .from('employees')
    .select(
      'id, employee_id, name, phone, role, manager_id, manager_phone, reports_to_employee_id',
    )
    .eq('is_active', true)
    .order('employee_id', { ascending: true });

  if (teamErr) {
    console.error('Error fetching team:', teamErr);
  } else {
    console.table(team);
  }
}

fixManagerLinkage().catch(console.error);
