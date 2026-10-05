export default () => ({
  port: parseInt(process.env.PORT, 10) || 3000,
  supabase: {
    url: process.env.SUPABASE_URL,
    key: process.env.SUPABASE_KEY,
  },
  admin: {
    superAdminEmail: process.env.SUPER_ADMIN_EMAIL || '',
    superAdminPassword: process.env.SUPER_ADMIN_PASSWORD || '',
  },
  database: {
    url: process.env.DATABASE_URL || '',
  },
});
