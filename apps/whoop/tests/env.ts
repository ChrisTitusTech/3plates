process.env.NODE_ENV = "test";
process.env.ClientID = "test-client";
process.env.ClientSecret = "test-secret";
process.env.TOKEN_KEY = "a".repeat(64);
process.env.PUBLIC_URL = "http://localhost:5173";
process.env.DATABASE_URL ??=
  "postgres://gallant_test:local-test-only@127.0.0.1:55433/gallant_test";
if (!new URL(process.env.DATABASE_URL).pathname.endsWith("/gallant_test"))
  throw new Error("Integration tests require a database named gallant_test");
