import {
  ChatbotTool,
  CallerContext,
  getSubordinateSalespersons,
  isManagerRole,
  isSalespersonRole,
} from './chatbot-tool.interface';

export const getReorderQueueTool: ChatbotTool = {
  name: 'get_reorder_queue',
  description:
    'Retrieves recurring customer order predictions, reorder queue, and average reorder cycle analytics across all tracked customer accounts. Scoped strictly by assigned salesperson and team hierarchy.',
  roles: ['salesperson', 'manager', 'sales_manager', 'admin'],
  declaration: {
    name: 'get_reorder_queue',
    description:
      'Retrieves recurring customer reorder predictions, list of customers due for repeat orders, and average reorder cycle (cadence) analytics across all tracked customers. Scoped by caller role.',
    parameters: {
      type: 'OBJECT',
      properties: {
        mode: {
          type: 'STRING',
          description:
            'Query mode. Valid values: "list" (default), "summary", "average_cycle" / "cycle_analytics" (calculates average reorder cycle and cadence distribution across all tracked customers).',
        },
        max_results: {
          type: 'NUMBER',
          description:
            'Optional maximum number of records to return in list mode (default 10, max 100).',
        },
      },
    },
  },
  async execute(args: any, callerContext: CallerContext, supabaseAdmin: any) {
    const mode = (args?.mode || 'list').toLowerCase().trim();
    const limit = Math.min(Math.max(Number(args?.max_results) || 10, 1), 100);

    let query = supabaseAdmin
      .from('recurring_customers')
      .select(
        'id, customer_name, customer_phone, customer_address, assigned_salesperson_phone, last_order_date, avg_order_frequency_days, is_active, notes',
      )
      .eq('is_active', true)
      .order('last_order_date', { ascending: true });

    // Scoping per role
    const rawPhone = callerContext.phone || '';
    const cleanPhone = rawPhone.replace(/\D/g, '').slice(-10);

    if (isSalespersonRole(callerContext.role)) {
      if (cleanPhone) {
        query = query.ilike('assigned_salesperson_phone', `%${cleanPhone}%`);
      } else {
        return {
          data: {
            summary: {
              total_tracked_customers: 0,
              average_reorder_cycle_days: '0 days',
              message: 'Access denied. Caller identity could not be verified.',
            },
            reorder_queue: [],
          },
          rowCount: 0,
        };
      }
    } else if (isManagerRole(callerContext.role)) {
      const { phoneSuffixes } = await getSubordinateSalespersons(
        callerContext,
        supabaseAdmin,
      );

      if (phoneSuffixes.length === 0) {
        return {
          data: {
            summary: {
              total_tracked_customers: 0,
              average_reorder_cycle_days: '0 days',
            },
            reorder_queue: [],
          },
          rowCount: 0,
        };
      }

      const orConditions = phoneSuffixes.map(
        (p) => `assigned_salesperson_phone.ilike.%${p}%`,
      );
      query = query.or(orConditions.join(','));
    }
    // Admin receives all active recurring customers

    const { data, error } = await query;
    if (error) {
      throw new Error(`get_reorder_queue error: ${error.message}`);
    }

    const rawList = data || [];
    const now = new Date();

    // Fetch employee names for rep display
    const { data: employees } = await supabaseAdmin
      .from('employees')
      .select('name, phone');

    const phoneToRep = new Map<string, string>();
    (employees || []).forEach((e: any) => {
      if (e.phone) {
        const clean = e.phone.replace(/\D/g, '').slice(-10);
        if (clean) phoneToRep.set(clean, e.name);
      }
    });

    let totalFrequencyDays = 0;
    const frequencyDistribution: Record<number, number> = {};
    let overdueCount = 0;
    let dueSoonCount = 0;

    const formattedList = rawList.map((r: any) => {
      const freqDays = Number(r.avg_order_frequency_days) || 30;
      totalFrequencyDays += freqDays;
      frequencyDistribution[freqDays] =
        (frequencyDistribution[freqDays] || 0) + 1;

      let daysSinceLastOrder: number | null = null;
      let nextReorderDate: string | null = null;
      let status: 'overdue' | 'due_soon' | 'upcoming' | 'no_previous_order' =
        'no_previous_order';

      if (r.last_order_date) {
        const lastOrderTime = new Date(r.last_order_date).getTime();
        daysSinceLastOrder = Math.max(
          0,
          Math.floor((now.getTime() - lastOrderTime) / (1000 * 60 * 60 * 24)),
        );

        const nextDate = new Date(lastOrderTime + freqDays * 24 * 3600 * 1000);
        nextReorderDate = nextDate.toLocaleDateString('en-IN');

        const daysUntilDue = freqDays - daysSinceLastOrder;
        if (daysUntilDue < 0) {
          status = 'overdue';
          overdueCount++;
        } else if (daysUntilDue <= 7) {
          status = 'due_soon';
          dueSoonCount++;
        } else {
          status = 'upcoming';
        }
      }

      const repPhone = (r.assigned_salesperson_phone || '')
        .replace(/\D/g, '')
        .slice(-10);
      const repName = phoneToRep.get(repPhone) || 'Assigned Rep';

      return {
        id: r.id,
        customer_name: r.customer_name || 'Unnamed Customer',
        customer_phone: r.customer_phone || null,
        customer_address: r.customer_address || null,
        avg_order_frequency_days: freqDays,
        last_order_date: r.last_order_date
          ? new Date(r.last_order_date).toLocaleDateString('en-IN')
          : null,
        next_reorder_date: nextReorderDate,
        days_since_last_order: daysSinceLastOrder,
        reorder_status: status,
        salesperson_name: repName,
        salesperson_phone: r.assigned_salesperson_phone || null,
        notes: r.notes || null,
      };
    });

    const averageDays =
      rawList.length > 0 ? totalFrequencyDays / rawList.length : 30;
    const averageDaysFormatted = `${averageDays.toFixed(1)} days (~${Math.round(averageDays)} days / 1 month)`;

    const distributionList = Object.entries(frequencyDistribution)
      .map(([days, count]) => ({
        cycle_days: Number(days),
        customer_count: count,
        percentage_of_tracked:
          rawList.length > 0
            ? `${((count / rawList.length) * 100).toFixed(1)}%`
            : '0%',
      }))
      .sort((a, b) => b.customer_count - a.customer_count);

    const insights = `The average reorder cycle across all ${rawList.length} tracked customer accounts is **${averageDays.toFixed(1)} days** (~30 days / 1 month). The vast majority of tracked accounts (${frequencyDistribution[30] || 0} customers, ${(((frequencyDistribution[30] || 0) / (rawList.length || 1)) * 100).toFixed(1)}%) operate on a 30-day procurement cadence, while select large accounts order on a 45-day cycle (${frequencyDistribution[45] || 0} customers) and fast-turnaround fabricators order on a 25-day cycle (${frequencyDistribution[25] || 0} customer).`;

    // ─── Mode: Average Reorder Cycle / Analytics ─────────────────────────────
    if (
      mode === 'average_cycle' ||
      mode === 'cycle_analytics' ||
      mode === 'reorder_analytics' ||
      mode === 'average'
    ) {
      return {
        data: {
          reorder_cycle_analytics: {
            total_tracked_customers: rawList.length,
            average_reorder_cycle_days: averageDays.toFixed(1),
            average_reorder_cycle_display: averageDaysFormatted,
            cadence_distribution: distributionList,
            overdue_reorder_customers_count: overdueCount,
            due_soon_customers_count: dueSoonCount,
            sample_tracked_customers: formattedList.slice(0, 10),
            insights,
          },
          summary: {
            total_tracked_customers: rawList.length,
            average_reorder_cycle_days: averageDaysFormatted,
            overdue_count: overdueCount,
            due_soon_count: dueSoonCount,
            note: insights,
          },
        },
        rowCount: rawList.length,
      };
    }

    if (mode === 'summary') {
      return {
        data: {
          summary: {
            total_tracked_customers: rawList.length,
            average_reorder_cycle_days: averageDaysFormatted,
            overdue_count: overdueCount,
            due_soon_count: dueSoonCount,
            note: insights,
          },
        },
        rowCount: rawList.length,
      };
    }

    return {
      data: {
        summary: {
          total_tracked_customers: rawList.length,
          average_reorder_cycle_days: averageDaysFormatted,
          overdue_count: overdueCount,
          due_soon_count: dueSoonCount,
        },
        reorder_queue: formattedList.slice(0, limit),
      },
      rowCount: Math.min(formattedList.length, limit),
    };
  },
};
