require('dotenv').config();
const path = require('path');

function required(name, fallback) {
  const value = process.env[name] ?? fallback;
  if (value === undefined) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

module.exports = {
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.COMPANY_PORT || '3001', 10),
  // See ctf-platform/src/config.js for why this isn't tied to NODE_ENV.
  cookieSecure: process.env.COOKIE_SECURE === 'true',
  sessionSecrets: {
    customer: required('COMPANY_CUSTOMER_SESSION_SECRET'),
    employee: required('COMPANY_EMPLOYEE_SESSION_SECRET'),
    admin: required('COMPANY_ADMIN_SESSION_SECRET'),
  },
  db: {
    host: process.env.POSTGRES_HOST || 'postgres',
    port: parseInt(process.env.POSTGRES_PORT || '5432', 10),
    database: process.env.POSTGRES_DB || 'instant_ctf',
    user: process.env.POSTGRES_USER || 'instant_ctf',
    password: process.env.POSTGRES_PASSWORD || '',
  },
  internal: {
    internalApiUrl: process.env.INTERNAL_API_URL || 'http://internal-api:4001',
    templateServiceUrl: process.env.TEMPLATE_SERVICE_URL || 'http://template-service:4002',
    infraServiceUrl: process.env.INFRA_SERVICE_URL || 'http://infra-service:4003',
  },
  seed: {
    customerEmail: process.env.SEED_CUSTOMER_EMAIL || 'jordan.customer@example.com',
    customerPassword: process.env.SEED_CUSTOMER_PASSWORD || 'change_me_customer_password',
    employeeEmail: process.env.SEED_EMPLOYEE_EMAIL || 'sam.employee@instant.example',
    employeePassword: process.env.SEED_EMPLOYEE_PASSWORD || 'change_me_employee_password',
    companyAdminEmail: process.env.SEED_COMPANY_ADMIN_EMAIL || 'riley.admin@instant.example',
    companyAdminPassword: process.env.SEED_COMPANY_ADMIN_PASSWORD || 'change_me_company_admin_password',
  },
  // Plaintext flag values embedded/served at each challenge's vulnerable
  // location. ctf-platform reads the same env vars to compute flag_hash -
  // see .env.example.
  flags: {
    infoDisclosure: required('FLAG_INFO_DISCLOSURE'),
    sqlInjection: required('FLAG_SQL_INJECTION'),
    pathTraversal: required('FLAG_PATH_TRAVERSAL'),
    authBypass: required('FLAG_AUTH_BYPASS'),
    xss: required('FLAG_XSS'),
  },
  // Root of the synthetic filesystem area used by the path-traversal
  // challenge (challenge 03). Baked into the Docker image; never a host
  // bind mount. See docs/CHALLENGES.md.
  challengeData: {
    root: path.join(__dirname, '..', 'challenge-data'),
    documentsDir: path.join(__dirname, '..', 'challenge-data', 'documents'),
    protectedDir: path.join(__dirname, '..', 'challenge-data', 'protected'),
  },
};
