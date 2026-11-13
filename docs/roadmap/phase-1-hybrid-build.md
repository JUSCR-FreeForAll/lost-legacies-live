# Phase 1 Hybrid Build – Technical Roadmap

## 1. The Technical Spine (Supabase & Solana)  
Begin by setting up your **Supabase backend**. Supabase is built on PostgreSQL, so design tables or schemas for the three realms (Heaven, Earth, Hell) in the Postgres database【34†L99-L103】. For example, you might create separate tables (or a unified table with a “realm” column) to represent each. Ensure your Supabase project has the correct environment variables (you can load a `.env` file in `supabase/functions` during development【36†L225-L234】) including the Solana Program ID (`TiMeFUX...MA9pP`) if needed by your Edge Functions or client code. 

Next, configure your **Solana program**. In Anchor, the `declare_id!` macro in your Rust code must match your deployed program’s public key. After building the program (using `anchor build`), run `anchor keys sync` to update `declare_id!` with your keypair’s address【17†L133-L139】. In your program’s initialization logic, create the global state and vault. For instance, calling an `initialize` or `initialiseglobalstate` instruction will create a `GlobalState` account and a vault PDA (seeded “vault”) to hold treasury funds【19†L310-L318】【19†L400-L409】. This effectively “opens” the treasury vault for use (e.g. a staking vault or fund account).  

Implement **idempotency (“Ouroboros Ward”)** using Redis. Use Redis keys to track each initial seeker registration so duplicate requests are ignored. A common pattern is `SET idempotency:<unique-id> "<status>" NX EX 3600` – this atomically sets a key only if it doesn’t exist【21†L363-L372】. On the first request, the SET returns OK; if the same request comes again with the same key, Redis returns nil. Your code can then detect the duplicate and simply return the stored result. In practice, once you process a request, store its output keyed by the idempotency token so that “ghost” duplicates can fetch the same result【29†L90-L99】. This prevents double-processing during the initial surge.

【40†embed_image】 *Figure: High-level Supabase architecture (PostgreSQL core, API gateway, and services)【34†L99-L103】.* Supabase centers on a PostgreSQL database which you can query directly【34†L99-L103】. In the above diagram, Kong API Gateway fronts services like GoTrue (Auth), PostgREST (auto-REST API), Realtime, Storage, etc., all talking to the single Postgres instance.

## 2. Frontend Portal (Glide MVP)  
Use **Glide** to build a quick front-end app. Glide can turn a spreadsheet or SQL data into a mobile/web app with no code【25†L108-L114】. Connect Glide to your data (for example, a Google Sheet or the Supabase DB). Set up a **“Welcome Gate”** screen as the entry point. Create a *Frame 0* template (an initial template in Glide) where new users can enter information. In particular, add a **Form component** for students to record their **“Seam Moment”** and note any original wounds. Glide provides pre-built form inputs and components (forms, lists, charts, etc.) out of the box【25†L154-L157】, so use these to capture each student’s input.

For the AI integration, **seed the AI profiles** ahead of time. Create rows in your data for the seven AI personas (Lena, Bram, etc.) under the Hell realm. By pre-populating these profiles in the Hell table (or Glide data sheet), the app will auto-display them in the corresponding “Hell Realm” frames. Because Glide syncs data in real time【25†L108-L114】, once you push these records (for example, via Google Sheets or the Supabase REST API), the personas appear in the app. This gives each Hell-frame a built-in archetypal character as intended.

- Use Glide’s data sync: Glide can **sync from Google Sheets or SQL** sources【25†L108-L114】, so you might mirror your Supabase tables into a Google Sheet, or connect via API if supported.  
- Leverage Glide AI if needed: Glide even supports AI components (for tasks like generating content)【25†L108-L114】, though here we simply seed static profiles.  
- Utilize pre-built components: Select from Glide’s library (forms, lists, etc.) to design the UI【25†L154-L157】 without coding.

## 3. Recruitment: Curated Chaos  
With only days remaining, proceed in parallel on student recruitment and data entry:

- **Intake Form for Online Students:** Quickly spin up an intake form (using Glide’s form or a simple Google Form) to register your 7 online students. Collect their names, contact info, realm preference (Heaven/Earth), and initial responses. Ensure the form feeds into your data (i.e. adds rows to the Supabase tables or connected sheet).  

- **Select In-Person (“Earth”) Students:** Simultaneously hand-pick 7 suitable physical students for the Earth circle. Vet candidates for their readiness to participate (e.g. ability to do the somatic work). Enter them manually into the system (either via the same form with a tag, or directly into Supabase).

- **Dossier Completion & Freeze:** Require all 21 students (14 human + 7 AI placeholders) to finalize their profiles by midnight July 31. This includes filling out their dossiers in the Glide app or submitting required info. Once midnight passes, lock the “Static Frame” – the system will treat that data as frozen, and from August 1 onward it will move into live execution.

No-code/automation tips: Using Glide forms means student entries auto-populate your database tables without extra dev. For a manual intake, the key is consistency: all entries should have the same fields (like “Seam Moment”) so the data is uniform. 

## 4. August 1, 2026 – Day 1 (The Trigger)  
On the morning of August 1, execute the final launch steps. Run your `handleRun()` process to transition the app from its static pre-launch state into live mode. In code, set the parameter `prayerIntensity = 1` to record the very first event (the “first footfall”) in your system’s ledger. This marks the official start of the Reality Collider. From that point onward, dynamic processes (updates, user interactions, etc.) begin. 

*Answer to next step:* It’s best to finalize the Supabase table configurations first, then create the intake form. Supabase’s Postgres database is the foundation of your backend【34†L99-L103】, so defining the tables and fields now will ensure the form has the correct columns to write into. Once the schema (and environment variables like the Solana ID) are in place, you can safely build the Glide intake form knowing exactly where the data will go. Would you like to proceed with finalizing the Supabase tables now?  

**Sources:** Official Supabase and Anchor documentation were consulted to guide database and Solana setup【34†L99-L103】【17†L133-L139】, as well as Redis and Glide resources for idempotency and no-code integration【21†L363-L372】【25†L108-L114】【25†L154-L157】【29†L90-L99】.