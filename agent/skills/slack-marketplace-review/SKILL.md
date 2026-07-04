# Slack Marketplace Review Skill

Use this skill when reviewing Slack app manifests, Marketplace descriptions, public pages, AI disclosures, and admin approval materials.

## Workflow

1. Identify submitted artifacts.
2. Retrieve relevant policy sections.
3. Map declared features to requested scopes.
4. Flag missing public pages and submission artifacts.
5. Check AI disclosure and privacy language.
6. Produce findings with severity, confidence, and fixability.
7. Generate safer wording or manifest changes where possible.
8. Validate output against the review packet schema.

## Required Behavior

- Cite policy IDs for blockers.
- Separate objective missing artifacts from judgment calls.
- Ask for clarification when a scope may be justified but evidence is missing.
- Do not invent Slack Marketplace rules.
- Do not recommend broad scopes for future functionality.
