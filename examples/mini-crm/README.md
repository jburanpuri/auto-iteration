# Northstar contacts

A small, dependency-free contacts application with fictional contact records.
`product.html` shows contacts; `index.html` contains feedback. Both use `app.mjs` and `styles.css`. `export.mjs` serializes CSV files. Run checks with `node --test`.

Three independent demo defects:

1. General: search for a name with no matches, wait for zero results, then Export contacts. `exportCsv` calls `Object.keys(rows[0])` on an empty array and throws. Expected: download a CSV containing the name and email headers.
2. UI/UX: select Trial or Active. `renderContacts` reads the selected status but ignores it in the predicate. Expected: combine the status and search filters.
3. Performance: type Ada in search. The input handler waits a fixed 2000 ms before filtering six records already in memory. Expected: prompt updates without the unnecessary wait, including when clearing search.

Each issue can be fixed independently. Scope changes and regression checks to the approved proposal. The parent server owns feedback, approval, and deployment; this product has no approval endpoint. Do not alter the parent application or reset mechanism.
