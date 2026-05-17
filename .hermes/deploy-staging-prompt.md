TASK: Deploy the Capiro workflow feature to the STAGING environment.

## CONTEXT
- AWS Account: 967807252336
- Region: us-east-1
- ECS Cluster: capiro-staging
- Staging services: capiro-staging-api, capiro-staging-web
- The `aws` CLI is authenticated locally as `capirocli`
- Docker Desktop is running
- We already have locally-built images for linux/arm64 tagged as:
  - 967807252336.dkr.ecr.us-east-1.amazonaws.com/capiro/dev/api:latest
  - 967807252336.dkr.ecr.us-east-1.amazonaws.com/capiro/dev/web:latest

## STEPS

### Step 1: Authenticate Docker to ECR (if not already)
```
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin 967807252336.dkr.ecr.us-east-1.amazonaws.com
```

### Step 2: Tag and push images to staging ECR repos
The staging repos are capiro/staging/api and capiro/staging/web. Re-tag the dev images:
```
docker tag 967807252336.dkr.ecr.us-east-1.amazonaws.com/capiro/dev/api:latest 967807252336.dkr.ecr.us-east-1.amazonaws.com/capiro/staging/api:latest
docker push 967807252336.dkr.ecr.us-east-1.amazonaws.com/capiro/staging/api:latest

docker tag 967807252336.dkr.ecr.us-east-1.amazonaws.com/capiro/dev/web:latest 967807252336.dkr.ecr.us-east-1.amazonaws.com/capiro/staging/web:latest
docker push 967807252336.dkr.ecr.us-east-1.amazonaws.com/capiro/staging/web:latest
```

### Step 3: Run migration on staging database
First check if there's a staging migration task definition:
```
aws ecs list-task-definitions --family-prefix capiro-staging --region us-east-1 --sort DESC
```

If there's a migrate task, run it. If not, look at the capiro-staging-api task definition to find the DB connection info (env vars like DB_HOST, DB_PORT, DB_USER, DB_NAME and secrets for DB_PASSWORD). Then either:
- Register a one-off migrate task from the staging API task def with an overridden command
- Or find the network config from the staging API service and run the migration

The migration command should be:
```
node ./node_modules/prisma/build/index.js migrate deploy --schema=./prisma/schema.prisma
```

### Step 4: Seed the workflow template on staging
After migration, run the seed script against the staging DB. Same approach as step 3 but with command:
```
npx tsx prisma/seed-workflows.ts
```
Note: If the task def has readonlyRootFilesystem, you'll need a tmpfs mount on /tmp (we had this issue on dev and created revision :2 of the migrate task).

### Step 5: Update staging task definitions to use :latest images
Get the current staging API and web task definitions. Check what image tag they use. If they're pinned to an old tag, register new revisions pointing to :latest.

### Step 6: Update the staging services
```
aws ecs update-service --cluster capiro-staging --service capiro-staging-api --task-definition capiro-staging-api --force-new-deployment --region us-east-1
aws ecs update-service --cluster capiro-staging --service capiro-staging-web --task-definition capiro-staging-web --force-new-deployment --region us-east-1
```

### Step 7: Verify
Poll both services until the new deployment is PRIMARY with desired running count. Report status.

## IMPORTANT
- The staging database is SEPARATE from dev. The migration needs to run against staging's DB.
- Look at the staging service network config for subnets/security groups — they may differ from dev.
- Poll ECS task status every 15s when waiting for migration/seed tasks.
- Report any errors in full.
