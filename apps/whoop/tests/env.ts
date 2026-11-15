process.env.NODE_ENV = "test";
// Never inherit the deployed integration database or credentials in tests.
for (const key of ["WHOOP_DATABASE_URL", "WHOOP_CLIENT_ID", "WHOOP_CLIENT_SECRET", "WHOOP_TOKEN_KEY", "WHOOP_PUBLIC_URL"])
  delete process.env[key];
process.env.ClientID = "test-client";
process.env.ClientSecret = "test-secret";
process.env.TOKEN_KEY = "a".repeat(64);
process.env.PUBLIC_URL = "http://localhost:5173";
process.env.DATABASE_URL ??=
  "postgres://gallant_test:local-test-only@127.0.0.1:55433/gallant_test";
if (!new URL(process.env.DATABASE_URL).pathname.endsWith("/gallant_test"))
  throw new Error("Integration tests require a database named gallant_test");
// Pin every namespaced override before config.ts loads dotenv.
process.env.WHOOP_DATABASE_URL = process.env.DATABASE_URL;
process.env.WHOOP_CLIENT_ID = process.env.ClientID;
process.env.WHOOP_CLIENT_SECRET = process.env.ClientSecret;
process.env.WHOOP_TOKEN_KEY = process.env.TOKEN_KEY;
process.env.WHOOP_PUBLIC_URL = process.env.PUBLIC_URL;
