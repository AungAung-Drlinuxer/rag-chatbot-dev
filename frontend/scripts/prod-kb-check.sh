#!/usr/bin/env bash
set -e
unset KUBECONFIG
TOK=$(curl -sk -X POST https://api.drlinuxer.com/api/auth/login -H "Content-Type: application/json" -d '{"username":"dev","password":"dev"}' | python -c "import sys,json; print(json.load(sys.stdin)['access_token'])")
echo "== domains =="
curl -sk "https://api.drlinuxer.com/api/articles-domains" -H "Authorization: Bearer $TOK" | head -c 260
echo ""
echo "== sync-status =="
curl -sk "https://api.drlinuxer.com/api/sync-status" -H "Authorization: Bearer $TOK" | head -c 260
echo ""
