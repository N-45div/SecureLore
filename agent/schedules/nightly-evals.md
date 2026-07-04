# Nightly Evals

Run the SecureLore regression suite every night and after policy or skill changes.

Expected jobs:

- validate all review packet examples against schema
- run blocker detection fixtures
- run false-positive fixtures
- run MCP tool classification fixtures
- run manifest fix validity fixtures
- publish an eval summary to the maintainers' Slack channel

The schedule implementation is added in Phase 3 when Eve is initialized.
