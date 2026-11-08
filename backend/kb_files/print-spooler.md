# Runbook — Restart the Print Spooler

If the print service is stuck, restart the Windows Print Spooler.

1. Open **Services** (`services.msc`).
2. Find **Print Spooler** → right-click → **Restart**.
3. Re-add the printer by IP if it still fails.
4. Check the spooler error log (`Event Viewer`).

> Runbook owner: System team.
