import sys
sys.path.insert(0, ".")
from app.mcp import infra_agent as ia

CASES = [
    # commands
    ("kubectl get nodes", True), ("Kubectl get nodes", True),
    ("kubectl get pods -n rag-chatbot", True), ("kubectl get no", True),
    ("kubectl get pods -A", True), ("kubectl get svc -n rag-chatbot", True),
    ("kubectl get ns", True), ("kubectl get pvc -n rag-chatbot", True),
    ("kubectl get events -n rag-chatbot", True),
    ("kubectl get statefulsets -n rag-chatbot", True),
    ("kubectl get deployments -n rag-chatbot", True),
    ("kubectl get deploy -A", True), ("kubectl get nodes -o wide", True),
    # natural language
    ("list the clusters", True), ("what clusters do you manage?", True),
    ("what is the cluster status?", True), ("what is the node capacity?", True),
    ("what is running in the rag-chatbot namespace?", True),
    ("is everything healthy?", True), ("which workloads have problems?", True),
    ("what went wrong recently?", True), ("how much memory is being used?", True),
    ("what is using the most memory?", True), ("where is my storage going?", True),
    ("are there any warnings in the cluster?", True), ("do any nodes have taints?", True),
    ("what version is kubernetes running?", True), ("show me cpu usage", True),
    ("what can you check in kubernetes?", True), ("why is the backend pod restarting?", True),
    ("nodes status", True), ("show me the nodes", True), ("are all nodes ready?", True),
    ("how many nodes do we have?", True), ("are there any unhealthy pods?", True),
    ("which deployments are not ready?", True), ("how much cpu is requested on the nodes?", True),
    ("are there any pods stuck in pending?", True), ("which pods are crashing?", True),
    ("are there any pods with restarts?", True), ("show node roles", True),
    ("what is the node capacity?", True), ("what clusters do you manage?", True),
    # must stay on the knowledge base
    ("what is a kubernetes pod?", False),
    ("how do I create a deployment in kubernetes?", False),
    ("how do I reset my VPN password?", False),
    ("explain kubernetes architecture", False),
    ("what is the difference between a pod and a deployment?", False),
    ("how to set up a namespace in kubernetes", False),
    ("how much memory does a pod need?", False),
    ("what is a service in kubernetes?", False),
    ("how do I install helm?", False),
    ("I forgot my email password", False),
]

bad = [(q, ia.detect_infra_intent(q), want) for q, want in CASES
       if ia.detect_infra_intent(q) != want]
print(f"cases: {len(CASES)}   mismatches: {len(bad)}")
for q, got, want in bad:
    print(f"   BAD  expected={'LIVE' if want else 'KB':4} got={'LIVE' if got else 'KB':4} {q}")
