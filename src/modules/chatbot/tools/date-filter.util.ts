/**
 * Shared Date Filter Utility for Enlight Metals Sales OS Chatbot Tools.
 * Standardizes date range calculations and aliases across get_complaints, get_visits, get_inquiries, and get_my_open_deals.
 */

export interface DateFilterRange {
  from?: Date;
  to?: Date;
}

export function parseDateFilter(dateFilter?: string): DateFilterRange {
  if (!dateFilter || dateFilter === 'all') return {};
  const now = new Date();
  const lower = dateFilter.toLowerCase().trim();

  // 1. Today (English + Hindi)
  if (lower === 'today' || lower === 'aaj') {
    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);
    return { from: startOfToday };
  }

  // 2. Yesterday (English + Hindi)
  if (lower === 'yesterday' || lower === 'kal') {
    const startOfYesterday = new Date(now);
    startOfYesterday.setDate(startOfYesterday.getDate() - 1);
    startOfYesterday.setHours(0, 0, 0, 0);
    const endOfYesterday = new Date(now);
    endOfYesterday.setDate(endOfYesterday.getDate() - 1);
    endOfYesterday.setHours(23, 59, 59, 999);
    return { from: startOfYesterday, to: endOfYesterday };
  }

  // 3. This Week / Last 7 Days (English + Aliases)
  if (
    lower === 'this_week' ||
    lower === 'this week' ||
    lower === 'week' ||
    lower === 'last_7_days' ||
    lower === '7_days' ||
    lower === 'last 7 days' ||
    lower === '7 days' ||
    lower === 'past_7_days' ||
    lower === 'past 7 days' ||
    lower === 'recent'
  ) {
    const startOf7Days = new Date(now);
    startOf7Days.setDate(startOf7Days.getDate() - 7);
    startOf7Days.setHours(0, 0, 0, 0);
    return { from: startOf7Days };
  }

  // 4. Last Week / Previous Week
  if (
    lower === 'last_week' ||
    lower === 'last week' ||
    lower === 'previous_week' ||
    lower === 'pichle hafte'
  ) {
    const endOfLastWeek = new Date(now);
    endOfLastWeek.setDate(endOfLastWeek.getDate() - 7);
    endOfLastWeek.setHours(23, 59, 59, 999);
    const startOfLastWeek = new Date(now);
    startOfLastWeek.setDate(startOfLastWeek.getDate() - 14);
    startOfLastWeek.setHours(0, 0, 0, 0);
    return { from: startOfLastWeek, to: endOfLastWeek };
  }

  // 5. Fortnight / 14 Days
  if (
    lower === 'fortnight' ||
    lower === 'last_14_days' ||
    lower === '14_days' ||
    lower === 'last 14 days' ||
    lower === '14 days'
  ) {
    const startOf14Days = new Date(now);
    startOf14Days.setDate(startOf14Days.getDate() - 14);
    startOf14Days.setHours(0, 0, 0, 0);
    return { from: startOf14Days };
  }

  // 6. Last 30 Days
  if (
    lower === 'last_30_days' ||
    lower === '30_days' ||
    lower === 'last 30 days' ||
    lower === '30 days' ||
    lower === 'past_30_days' ||
    lower === 'past 30 days'
  ) {
    const startOf30Days = new Date(now);
    startOf30Days.setDate(startOf30Days.getDate() - 30);
    startOf30Days.setHours(0, 0, 0, 0);
    return { from: startOf30Days };
  }

  // 7. This Month (MTD)
  if (
    lower === 'this_month' ||
    lower === 'this month' ||
    lower === 'month' ||
    lower === 'is mahine' ||
    lower === 'is_mahine' ||
    lower === 'mtd'
  ) {
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    startOfMonth.setHours(0, 0, 0, 0);
    return { from: startOfMonth };
  }

  // 8. Last Month (Full previous month)
  if (
    lower === 'last_month' ||
    lower === 'last month' ||
    lower === 'previous_month' ||
    lower === 'previous month' ||
    lower === 'pichle mahine' ||
    lower === 'pichle_mahine'
  ) {
    const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    startOfLastMonth.setHours(0, 0, 0, 0);
    const endOfLastMonth = new Date(
      now.getFullYear(),
      now.getMonth(),
      0,
      23,
      59,
      59,
      999,
    );
    return { from: startOfLastMonth, to: endOfLastMonth };
  }

  // 9. Last 3 Months / Quarter
  if (
    lower === 'last_3_months' ||
    lower === 'last_3months' ||
    lower === '3_months' ||
    lower === '3months' ||
    lower === 'last 3 months' ||
    lower === 'three_months' ||
    lower === 'this_quarter' ||
    lower === 'last_quarter'
  ) {
    const startOf3Months = new Date(now.getFullYear(), now.getMonth() - 2, 1);
    startOf3Months.setHours(0, 0, 0, 0);
    return { from: startOf3Months };
  }

  // 10. Last 6 Months (Half Year)
  if (
    lower === 'last_6_months' ||
    lower === 'last_6months' ||
    lower === '6_months' ||
    lower === '6months' ||
    lower === 'six_months' ||
    lower === 'last 6 months' ||
    lower === 'half_year'
  ) {
    const startOf6Months = new Date(now.getFullYear(), now.getMonth() - 5, 1);
    startOf6Months.setHours(0, 0, 0, 0);
    return { from: startOf6Months };
  }

  // 11. Last 12 Months / This Year / Last Year
  if (
    lower === 'last_12_months' ||
    lower === '12_months' ||
    lower === 'last 12 months' ||
    lower === 'this_year' ||
    lower === 'this year' ||
    lower === 'ytd'
  ) {
    const startOfYear = new Date(now.getFullYear(), 0, 1);
    startOfYear.setHours(0, 0, 0, 0);
    return { from: startOfYear };
  }

  if (lower === 'last_year' || lower === 'last year') {
    const startOfLastYear = new Date(now.getFullYear() - 1, 0, 1);
    startOfLastYear.setHours(0, 0, 0, 0);
    const endOfLastYear = new Date(
      now.getFullYear() - 1,
      11,
      31,
      23,
      59,
      59,
      999,
    );
    return { from: startOfLastYear, to: endOfLastYear };
  }

  // 12. Regex for N days (e.g. "last 14 days", "10 days", "60 days")
  const daysMatch = lower.match(/(?:last|past)?\s*(\d+)\s*(?:days?|d)\b/i);
  if (daysMatch) {
    const days = parseInt(daysMatch[1], 10);
    if (!isNaN(days) && days > 0) {
      const startOfNDays = new Date(now);
      startOfNDays.setDate(startOfNDays.getDate() - days);
      startOfNDays.setHours(0, 0, 0, 0);
      return { from: startOfNDays };
    }
  }

  // 13. Regex for N months (e.g. "last 4 months", "2 months")
  const monthsMatch = lower.match(/(?:last|past)?\s*(\d+)\s*(?:months?|m)\b/i);
  if (monthsMatch) {
    const months = parseInt(monthsMatch[1], 10);
    if (!isNaN(months) && months > 0) {
      const startOfNMonths = new Date(
        now.getFullYear(),
        now.getMonth() - (months - 1),
        1,
      );
      startOfNMonths.setHours(0, 0, 0, 0);
      return { from: startOfNMonths };
    }
  }

  // 14. Named calendar months (e.g. "january", "august", "sep")
  const monthMap: Record<string, number> = {
    jan: 0,
    january: 0,
    feb: 1,
    february: 1,
    mar: 2,
    march: 2,
    apr: 3,
    april: 3,
    may: 4,
    jun: 5,
    june: 5,
    jul: 6,
    july: 6,
    aug: 7,
    august: 7,
    sep: 8,
    sept: 8,
    september: 8,
    oct: 9,
    october: 9,
    nov: 10,
    november: 10,
    dec: 11,
    december: 11,
  };

  const monthKeys = Object.keys(monthMap);
  for (const mKey of monthKeys) {
    if (
      lower === mKey ||
      lower.startsWith(`${mKey} `) ||
      lower.endsWith(` ${mKey}`)
    ) {
      const monthIdx = monthMap[mKey];
      let year = now.getFullYear();
      // If requested month is later in the year than current month, assume previous year
      if (monthIdx > now.getMonth()) {
        year -= 1;
      }
      const startOfMonth = new Date(year, monthIdx, 1);
      startOfMonth.setHours(0, 0, 0, 0);
      const endOfMonth = new Date(year, monthIdx + 1, 0, 23, 59, 59, 999);
      return { from: startOfMonth, to: endOfMonth };
    }
  }

  // 15. Explicit parseable date string (e.g. "2026-09-01")
  const parsed = new Date(dateFilter);
  if (!isNaN(parsed.getTime())) {
    const start = new Date(parsed);
    start.setHours(0, 0, 0, 0);
    const end = new Date(parsed);
    end.setHours(23, 59, 59, 999);
    return { from: start, to: end };
  }

  return {};
}
