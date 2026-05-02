#!/usr/bin/env bash
# Deploy marketing/index.html to capiro.ai (S3 + CloudFront).
#
# Usage:  ./marketing/deploy.sh
# Prereqs: AWS CLI configured with permissions for the bucket + distribution.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$HERE/index.html"
BUCKET="capiro-landing-967807252336-us-east-1"
DIST_ID="E30MT6RQI7501Q"
REGION="us-east-1"

if [[ ! -f "$SRC" ]]; then
  echo "ERROR: $SRC not found" >&2
  exit 1
fi

TS="$(date +%Y%m%d-%H%M%S)"

echo "→ backing up current index.html as index.html.bak-$TS"
aws s3 cp "s3://$BUCKET/index.html" "s3://$BUCKET/index.html.bak-$TS" \
  --region "$REGION" --only-show-errors

echo "→ uploading $SRC"
aws s3 cp "$SRC" "s3://$BUCKET/index.html" \
  --region "$REGION" \
  --content-type "text/html; charset=utf-8" \
  --cache-control "public, max-age=300" \
  --only-show-errors

if [[ -d "$HERE/assets" ]]; then
  echo "→ syncing assets/"
  aws s3 sync "$HERE/assets/" "s3://$BUCKET/assets/" \
    --region "$REGION" \
    --cache-control "public, max-age=86400" \
    --delete \
    --only-show-errors
fi

echo "→ invalidating CloudFront $DIST_ID"
INV_ID="$(aws cloudfront create-invalidation \
  --distribution-id "$DIST_ID" \
  --paths '/*' \
  --query 'Invalidation.Id' --output text)"
echo "  invalidation id: $INV_ID"

echo "✓ done — https://capiro.ai (cache propagation typically 30-60s)"
