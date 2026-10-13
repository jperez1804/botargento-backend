// The in-memory DB (DATABASE_PATH=":memory:") is migrated by db/client.ts on import
// via drizzle's migrator — re-applying the SQL files here made every suite fail with
// "table already exists".
import "./db/client.js";
