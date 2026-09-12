# Auto Iteration · Demo CRM

A deliberately small, dependency-free customer directory. All customers are fictional.

`index.html`, `styles.css`, and `app.mjs` implement the interface. `customers.mjs` owns data and filtering. `export.mjs` is the CSV exporter. Run tests with `node --test`. The parent Auto Iteration server serves this product and provides `/api/feedback` and `/api/tasks`; the product has no approval endpoint.

Known feedback scenarios:

- Engineering: exporting zero results throws because the exporter assumes a first row exists.
- UI/UX: there is no single action to reset search and status together.
- Performance: search updates are delayed 900 ms even with eight in-memory records, with uncancelled timers.

Changes should stay scoped to the approved proposal and include relevant regression tests. No build step, network access, database, or dependency installation is needed.
