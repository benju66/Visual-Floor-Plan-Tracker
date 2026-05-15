# TASK: Post-Implementation Verification & Teardown

Execute these steps sequentially. Stop and ask for clarification if any step fails or encounters an unexpected state.

**Step 1: Intent vs. Execution Audit**
Review the original Implementation Plan and compare it directly against the current state of the file system, independent of version control.

* Identify all files you created, modified, or deleted during this current implementation session.
* Read the current contents of those specific files into your context.
* Evaluate the actual written code against the plan to answer:
  * Did the execution satisfy every requirement? 
  * Were any unauthorized changes made outside the scope of the original plan? 
Flag any discrepancies.

**Step 2: Cross-Surface Verification**
Do not just read the code—prove it works. 
* Run the relevant test suites in the terminal.
* If UI/UX components were altered, launch the browser environment and visually verify the changes (e.g., mobile swipe-card interactions, routing flows). 
Report the exact terminal commands run and their outputs.

**Step 3: Architecture & Rule Sync**
Review the newly written code against `ARCHITECTURE.md` and `AGENTS.md`. 
* Did this feature introduce new containers, alter database schemas, or change external data flows? If yes, automatically draft the required updates to `ARCHITECTURE.md` using the C4 Model structure.
* Are there new standard operating procedures or reusable patterns created here that should be added to `AGENTS.md`?

**Step 4: The Merge Gate**
Present a final "Definition of Done" report summarizing the test results and documentation updates. **Stop entirely.** Do not attempt to commit, push, or merge this worktree into the main branch until I explicitly reply with "Approved."