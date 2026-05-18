TASK: Build and deploy ALL phases (A+B+C+D) to dev and staging.

## STEPS

### Step 1: Auth to ECR
```
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin 967807252336.dkr.ecr.us-east-1.amazonaws.com
```

### Step 2: Build and push API image
```
docker build --platform linux/arm64 -t capiro-api -f apps/api/Dockerfile .
docker tag capiro-api:latest 967807252336.dkr.ecr.us-east-1.amazonaws.com/capiro/dev/api:latest
docker push 967807252336.dkr.ecr.us-east-1.amazonaws.com/capiro/dev/api:latest
docker tag capiro-api:latest 967807252336.dkr.ecr.us-east-1.amazonaws.com/capiro/staging/api:latest
docker push 967807252336.dkr.ecr.us-east-1.amazonaws.com/capiro/staging/api:latest
```

### Step 3: Build and push Web image
```
docker buildx build --platform linux/arm64 -f apps/web/Dockerfile -t capiro-web --load .
docker tag capiro-web:latest 967807252336.dkr.ecr.us-east-1.amazonaws.com/capiro/dev/web:latest
docker push 967807252336.dkr.ecr.us-east-1.amazonaws.com/capiro/dev/web:latest
docker tag capiro-web:latest 967807252336.dkr.ecr.us-east-1.amazonaws.com/capiro/staging/web:latest
docker push 967807252336.dkr.ecr.us-east-1.amazonaws.com/capiro/staging/web:latest
```

### Step 4: Re-seed both environments
The seed needs to run to update the NDAA template with the new requiredSections.

For STAGING:
```
aws ecs run-task --cluster capiro-staging --task-definition capiro-staging-api-migrate:12 --launch-type FARGATE --network-configuration "awsvpcConfiguration={subnets=[subnet-0264aac77ddc5dc84,subnet-085b77acaa84d32b6,subnet-02bfdcf438ba6aa15],securityGroups=[sg-0fc51433f9441bc73],assignPublicIp=DISABLED}" --region us-east-1 --overrides '{"containerOverrides":[{"name":"api","entryPoint":["/usr/bin/dumb-init","--","sh","-c"],"command":["MASTER_ENC=$(node -e \"process.stdout.write(encodeURIComponent(process.argv[1]))\" \"$MASTER_PASSWORD\") && export DATABASE_URL=\"postgresql://${MASTER_USER}:${MASTER_ENC}@${DB_HOST}:${DB_PORT}/${DB_NAME}?schema=public&sslmode=require\" && ./node_modules/.bin/tsx prisma/seed-workflows.ts"]}]}'
```

For DEV, run the seed similarly. Check the dev migrate task definition:
```
aws ecs list-task-definitions --family-prefix capiro-dev-api-admin-migrate --region us-east-1 --sort DESC --max-items 1
```
Use the latest revision. Override command to run seed only. The dev task has DB creds in env already.

Wait for both seed tasks to complete (poll every 15s). Check exit codes.

### Step 5: Force deploy all services
```
aws ecs update-service --cluster capiro-dev --service capiro-dev-api --force-new-deployment --region us-east-1
aws ecs update-service --cluster capiro-dev --service capiro-dev-web --force-new-deployment --region us-east-1
aws ecs update-service --cluster capiro-staging --service capiro-staging-api --force-new-deployment --region us-east-1
aws ecs update-service --cluster capiro-staging --service capiro-staging-web --force-new-deployment --region us-east-1
```

### Step 6: Verify
Check all 4 services show running == desired. Report final status.
