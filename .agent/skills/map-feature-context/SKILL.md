# TASK: Feature Mapping & Contextual Discovery

Execute these steps to build a 360-degree understanding of the target feature. Stop and ask for clarification if you find conflicting logic or dead-end code paths.

**Step 1: Codebase Indexing & File Discovery**
Search the entire repository to identify every file, service, or component related to this feature. 
* Look for: API routes, database models, utility functions, UI components, and test files.
* Output: A structured list of "Primary Impact Files" (direct changes) and "Secondary Impact Files" (dependencies).

**Step 2: Data Flow & Dependency Mapping**
Trace the data lifecycle for this feature.
* Where does the data originate (e.g., a Procore webhook, user input, or local DB)?
* How is it transformed, and which services handle the logic?
* Where is the final state stored or displayed?


**Step 3: Integration & Security Audit**
Identify every external touchpoint.
* Are there OAuth scopes involved? 
* Does this touch any specific multi-family project logic or bulk-engine processes?
* Check against current architecture

**Step 4: Pattern Recognition**
Review `AGENTS.md` and existing components to identify the "house style."
* What reusable patterns or custom hooks are already in place that must be leveraged?
* Are there "forbidden" patterns (like offline caching or scan-detect logic) we must avoid?

**Step 5: Contextual Summary**
Provide a concise summary of the current implementation's "current state" and identify the exact "blast radius" for the proposed updates. Do not propose a plan yet.