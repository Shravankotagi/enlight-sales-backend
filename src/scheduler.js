const { checkRecurringCustomers } = require('./kra3');

function startScheduler() {
  console.log('Scheduler started');
  
  // Run KRA 3 check immediately on startup (for testing)
  // In production this runs at 9 PM daily
  
  // Check every 24 hours
  const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;
  
  // Calculate time until next 9 PM IST
  function getNextRunTime() {
    const now = new Date();
    const IST_OFFSET = 5.5 * 60 * 60 * 1000;
    const istNow = new Date(now.getTime() + IST_OFFSET);
    
    const next9PM = new Date(istNow);
    next9PM.setHours(21, 0, 0, 0);
    
    if (istNow.getHours() >= 21) {
      next9PM.setDate(next9PM.getDate() + 1);
    }
    
    return next9PM.getTime() - istNow.getTime();
  }
  
  // Schedule first run
  const timeToFirstRun = getNextRunTime();
  console.log(`Next KRA 3 check in ${Math.round(timeToFirstRun / 1000 / 60)} minutes`);
  
  setTimeout(async () => {
    await checkRecurringCustomers();
    // Then run every 24 hours
    setInterval(checkRecurringCustomers, TWENTY_FOUR_HOURS);
  }, timeToFirstRun);
}

// For manual trigger (testing)
async function runNow() {
  console.log('Manual KRA 3 check triggered...');
  await checkRecurringCustomers();
}

module.exports = { startScheduler, runNow };
