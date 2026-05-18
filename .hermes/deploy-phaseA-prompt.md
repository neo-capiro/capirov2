TASK: Build and deploy updated images to dev and staging, then re-seed both environments.

## STEPS

### Step 1: Auth to ECR
```
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin 967807252336.dkr.ecr.us-east-1.amazonaws.com
```

### Step 2: Build API image (only the seed changed, but the image needs rebuilding)
```
docker build --platform linux/arm64 -t capiro-api -f apps/api/Dockerfile .
docker tag capiro-api:latest 967807252336.dkr.ecr.us-east-1.amazonaws.com/capiro/dev/api:latest
docker push 967807252336.dkr.ecr.us-east-1.amazonaws.com/capiro/dev/api:latest
docker tag capiro-api:latest 967807252336.dkr.ecr.us-east-1.amazonaws.com/capiro/staging/api:latest
docker push 967807252336.dkr.ecr.us-east-1.amazonaws.com/capiro/staging/api:latest
```

### Step 3: Build Web image
```
docker buildx build --platform linux/arm64 -f apps/web/Dockerfile -t capiro-web .
docker tag capiro-web:latest 967807252336.dkr.ecr.us-east-1.amazonaws.com/capiro/dev/web:latest
docker push 967807252336.dkr.ecr.us-east-1.amazonaws.com/capiro/dev/web:latest
docker tag capiro-web:latest 967807252336.dkr.ecr.us-east-1.amazonaws.com/capiro/staging/web:latest
docker push 967807252336.dkr.ecr.us-east-1.amazonaws.com/capiro/staging/web:latest
```

### Step 4: Re-seed both environments
The seed script's update clause now also sets requiredSections, so re-running it will update the existing template.

For STAGING, run the seed task (revision 12 already has master creds + tmpfs):
```
aws ecs run-task --cluster capiro-staging --task-definition capiro-staging-api-migrate:12 --launch-type FARGATE --network-configuration "awsvpcConfiguration={subnets=[subnet-0264aac77ddc5dc84,subnet-085b77acaa84d32b6,subnet-02bfdcf438ba6aa15],securityGroups=[sg-0fc51433f9441bc73],assignPublicIp=DISABLED}" --region us-east-1 --overrides '{"containerOverrides":[{"name":"api","entryPoint":["/usr/bin/dumb-init","--","sh","-c"],"command":["MASTER_ENC=$(node -e \"process.stdout.write(encodeURIComponent(process.argv[1]))\" \"$MASTER_PASSWORD\") && export DATABASE_URL=\"postgresql://${MASTER_USER}:${MASTER_ENC}@${DB_HOST}:${DB_PORT}/${DB_NAME}?schema=public&sslmode=require\" && ./node_modules/.bin/tsx prisma/seed-workflows.ts"]}]}'
```

Wait for it to complete, then check the logs.

For DEV, run the seed the same way but on capiro-dev cluster. First check what migrate task definition exists:
```
aws ecs list-task-definitions --family-prefix capiro-dev-api-admin-migrate --region us-east-1 --sort DESC
```
Use the latest revision. The dev migrate task already has tmpfs from earlier. Override the command to just run the seed.

### Step 5: Force deploy all 4 services
```
aws ecs update-service --cluster capiro-dev --service capiro-dev-api --force-new-deployment --region us-east-1
aws ecs update-service --cluster capiro-dev --service capiro-dev-web --force-new-deployment --region us-east-1
aws ecs update-service --cluster capiro-staging --service capiro-staging-api --force-new-deployment --region us-east-1
aws ecs update-service --cluster capiro-staging --service capiro-staging-web --force-new-deployment --region us-east-1
```

### Step 6: Verify
Check that all 4 services show 1 deployment each with running == desired.

Report results.
