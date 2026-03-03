# Deployment Guide (Vultr VKE + GHCR)

This folder contains the manifests and Dockerfiles needed to deploy the project to Vultr Kubernetes Engine (VKE).

## Required Files
- `backend/Dockerfile`
- `backend/main.py`
- `backend/requirements.txt`
- `treeHacks/Dockerfile`
- `treeHacks/nginx.conf`
- `deploy/namespace.yaml`
- `deploy/backend-pvc.yaml`
- `deploy/backend-secret.yaml`
- `deploy/backend-deployment.yaml`
- `deploy/backend-service.yaml`
- `deploy/frontend-deployment.yaml`
- `deploy/frontend-service.yaml`
- `deploy/cluster-issuer.yaml`
- `deploy/ingress-backend.yaml`
- `deploy/ingress-frontend.yaml`

## Notes Before Deploying
- `deploy/backend-secret.yaml` contains Auth0 secrets. Replace values before committing or use placeholders.
- Update `APP_BASE_URL` to the final public hostname.
- Update `deploy/ingress-*.yaml` with the same hostname.
- Build the frontend with `VITE_API_BASE_URL` set to `https://<HOST>/api`.

---

## 1) Build & Push Images (GHCR)
Login:
```bash
echo "$GHCR_TOKEN" | docker login ghcr.io -u SKZ-04 --password-stdin
```

Build + push backend:
```bash
TAG=$(date +%Y%m%d%H%M)
docker buildx build --platform linux/amd64 \
  -t ghcr.io/skz-04/jesb-backend:$TAG \
  --push ./backend
```

Build + push frontend:
```bash
TAG=$(date +%Y%m%d%H%M)
docker buildx build --platform linux/amd64 \
  -t ghcr.io/skz-04/jesb-frontend:$TAG \
  --build-arg VITE_API_BASE_URL=https://<HOST>/api \
  --push ./treeHacks
```

---

## 2) Install Ingress + Cert-Manager
```bash
helm repo add ingress-nginx https://kubernetes.github.io/ingress-nginx
helm repo add jetstack https://charts.jetstack.io
helm repo update

helm install ingress-nginx ingress-nginx/ingress-nginx \
  --namespace ingress-nginx --create-namespace

helm install cert-manager jetstack/cert-manager \
  --namespace cert-manager --create-namespace \
  --set crds.enabled=true
```

---

## 3) Create Pull Secret
```bash
kubectl create namespace dataframe

kubectl create secret docker-registry ghcr-credentials \
  --namespace dataframe \
  --docker-server=ghcr.io \
  --docker-username=SKZ-04 \
  --docker-password="$GHCR_TOKEN" \
  --docker-email="you@example.com"
```

---

## 4) Apply Manifests
```bash
kubectl apply -f deploy/namespace.yaml
kubectl apply -f deploy/backend-pvc.yaml
kubectl apply -f deploy/backend-secret.yaml
kubectl apply -f deploy/backend-deployment.yaml
kubectl apply -f deploy/backend-service.yaml
kubectl apply -f deploy/frontend-deployment.yaml
kubectl apply -f deploy/frontend-service.yaml
kubectl apply -f deploy/cluster-issuer.yaml
kubectl apply -f deploy/ingress-backend.yaml
kubectl apply -f deploy/ingress-frontend.yaml
```

---

## 5) Get LoadBalancer IP and TLS Host
```bash
kubectl get svc -n ingress-nginx
```

If the external IP is `203.0.113.10`, the hostname is:
```
203-0-113-10.sslip.io
```

Update:
- `APP_BASE_URL` in `deploy/backend-secret.yaml`
- hosts in `deploy/ingress-backend.yaml`
- hosts in `deploy/ingress-frontend.yaml`

Reapply:
```bash
kubectl apply -f deploy/backend-secret.yaml
kubectl apply -f deploy/ingress-backend.yaml
kubectl apply -f deploy/ingress-frontend.yaml
```

Restart frontend to pick up the new build:
```bash
kubectl rollout restart deployment/frontend -n dataframe
```

---

## 6) Verify
```bash
kubectl get pods -n dataframe
kubectl get certificate -n dataframe
```

Site URL:
```
https://<HOST>
```
