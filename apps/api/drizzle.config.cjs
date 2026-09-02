require('dotenv').config({ path: '../../.env' });

module.exports = {
  schema: ['./src/schema.ts', './src/pricingSchema.ts'],
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL || 'postgresql://wawi:wawi_password@localhost:5432/wawi_db',
  },
};
