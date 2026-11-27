---
name: Fortress DB connection discipline
description: Why a request must not hold two pool connections at once
---
A request handler must never hold a pool client while acquiring another (e.g. a read client plus withTransaction or pool.query in a helper).
**Why:** under concurrent requests this exhausted the pool and deadlocked the suite (verify running alongside backups).
**How to apply:** read with one client, release it, then open the write transaction; keep the concurrent verify test.
