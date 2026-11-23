---
name: handoff-notes
description: Format for the hand-off notes every agent writes so the next agent has context. Use at the end of each agent's work.
---

# Hand-off notes

File: `docs/handoffs/<yyyy-mm-dd>-<request-slug>.md` (create if missing, then append a section per agent).

```markdown
## <agent> – <PASS | NO IMPACT | CHANGES REQUESTED>
- **Summary**: what was decided/done
- **Artifacts**: files changed (ADRs, designs, code, tests)
- **Constraints / risks for next agent**:
- **Open questions**:
```

Rules: be brief; always include a section even when "no impact" (with the reason); never overwrite other agents' sections.
