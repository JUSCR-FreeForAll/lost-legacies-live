import { pool } from "@workspace/db";
import { fail } from "./errors";

/**
 * Durable fixed-window throttle stored in Postgres, so limits hold across
 * restarts and across multiple instances sharing the database.
 */
export async function throttle(key: string, max: number, windowMs: number): Promise<void> {
  const r = await pool.query<{ count: number }>(
    `INSERT INTO fortress_throttle (key, count, window_until)
     VALUES ($1, 1, now() + ($2::int * interval '1 millisecond'))
     ON CONFLICT (key) DO UPDATE SET
       count = CASE WHEN fortress_throttle.window_until <= now() THEN 1 ELSE fortress_throttle.count + 1 END,
       window_until = CASE WHEN fortress_throttle.window_until <= now()
                           THEN now() + ($2::int * interval '1 millisecond')
                           ELSE fortress_throttle.window_until END
     RETURNING count`,
    [key, windowMs],
  );
  if (Number(r.rows[0]?.count ?? 0) > max) {
    throw fail(429, "RATE_LIMITED", "Too many requests. Try again later.");
  }
}
