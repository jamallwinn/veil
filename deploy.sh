#!/bin/bash
# Veil Private XRP Payments - Cloud Run Deployment Script
# Usage: ./deploy.sh [staging|production]

set -e

# Configuration
PROJECT_ID="mhvoice"
REGION="us-central1"
SERVICE_NAME="veil-privacy"

# Parse environment argument
ENV=${1:-staging}
if [[ "$ENV" == "production" ]]; then
    SERVICE_NAME="veil-privacy-prod"
    MIN_INSTANCES=1
else
    SERVICE_NAME="veil-privacy-staging"
    MIN_INSTANCES=0
fi

echo "=============================================="
echo "Deploying Veil to Cloud Run"
echo "=============================================="
echo "Project:     $PROJECT_ID"
echo "Region:      $REGION"
echo "Service:     $SERVICE_NAME"
echo "Environment: $ENV"
echo "=============================================="

# Check if gcloud is configured
if ! gcloud config get-value project &>/dev/null; then
    echo "Error: gcloud not configured. Run: gcloud auth login && gcloud config set project $PROJECT_ID"
    exit 1
fi

# Set project
gcloud config set project $PROJECT_ID

# Build the Docker image
echo ""
echo "[1/3] Building Docker image..."
IMAGE_TAG="gcr.io/$PROJECT_ID/$SERVICE_NAME:$(date +%Y%m%d-%H%M%S)"
IMAGE_LATEST="gcr.io/$PROJECT_ID/$SERVICE_NAME:latest"

docker build \
    -t "$IMAGE_TAG" \
    -t "$IMAGE_LATEST" \
    --platform linux/amd64 \
    .

# Push to Container Registry
echo ""
echo "[2/3] Pushing to Container Registry..."
docker push "$IMAGE_TAG"
docker push "$IMAGE_LATEST"

# Deploy to Cloud Run
echo ""
echo "[3/3] Deploying to Cloud Run..."
gcloud run deploy "$SERVICE_NAME" \
    --image "$IMAGE_TAG" \
    --region "$REGION" \
    --platform managed \
    --allow-unauthenticated \
    --min-instances "$MIN_INSTANCES" \
    --max-instances 10 \
    --memory 512Mi \
    --cpu 1 \
    --timeout 300 \
    --set-env-vars "NODE_ENV=production"

# Get the deployed URL
echo ""
echo "=============================================="
echo "Deployment complete!"
echo "=============================================="
SERVICE_URL=$(gcloud run services describe "$SERVICE_NAME" --region "$REGION" --format 'value(status.url)')
echo "Service URL: $SERVICE_URL"
echo ""
echo "Test the deployment:"
echo "  curl $SERVICE_URL/health"
echo ""
