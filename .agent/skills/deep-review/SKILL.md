Execute the following steps sequentially. If you are unsure about any context or hit a blocker, stop and ask one clarifying question. Do not guess.

**Step 1: Primary Inspection**
Review `AGENTS.md` and the current Implementation Plan. Identify bugs, logical gaps, unhandled edge cases, and security flaws. Update the plan to fix any issue that causes a broken user flow, security flaw, or data loss.

**Step 2: Secondary Sweep**
Conduct a secondary sweep. Are there any other items you should review to eliminate potential edge cases? Update the plan with your findings.

**Step 3: Impact Analysis**
Investigate to confirm you fully understand everything impacted by these updates. Ensure these changes will not break adjacent modules. Outline a brief rollback strategy for the core files being modified.

**Step 4: Verification**
For every new fix added to the plan, define exactly how we will test and verify it works.

**Step 5: Review Gate**
Present the updated implementation plan. Stop and wait for my explicit approval before writing any code.