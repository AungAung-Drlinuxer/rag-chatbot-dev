"""Secrets resolution layer.

Import order in app config (see app/config.py):
  1. defaults from Settings class
  2. environment variables (k8s Secret mounted as env vars)
  3. OpenBao KV (this package, optional)

If OpenBao is unreachable, env-var values are kept.
"""
