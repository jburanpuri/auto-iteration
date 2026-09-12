# Auto Iteration

Auto Iteration turns customer feedback into tested product improvements, with engineers in control. It groups related reports, assesses whether they describe relevant, actionable issues, and uses the Codex SDK to investigate the code and propose a fix. A conversational Discord bot brings the issue, technical evidence, proposed solution, and confidence assessment to the right engineering team.

Engineers can ask questions, request changes, approve, or decline. Their feedback feeds back into Codex until the plan is ready. After approval, Codex implements the change, runs regression tests, and the worker publishes the verified fix to Vercel.

The demo has three surfaces: a company product with reproducible bugs, separate feedback and review pages, and Discord for engineering decisions. Individual feedback starts automatically; batches of reviews can be summarized with one button. Reset demo restores the bugs and clears the previous bot conversation so the workflow can be presented again.

The current runtime uses GPT-6 Astra with low reasoning on a local worker connected to the owner's Codex account. Public submissions queue through Vercel. Confidence describes content relevance and code evidence; it does not verify identity or detect AI authorship.
