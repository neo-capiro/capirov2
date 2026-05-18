TASK: Build the API Docker image, push to ECR, run the Prisma migration, and seed the workflow template on AWS.

## CONTEXT
- AWS Account: 967807252336
- Region: us-east-1
- ECS Cluster: capiro-dev
- ECR API Repo: capiro/dev/api
- The `aws` CLI is authenticated locally as `capirocli` user in account 967807252336
- The project is a pnpm monorepo. The API Dockerfile is at apps/api/Dockerfile.

## STEPS

### Step 1: Build and push Docker image to ECR
1. Authenticate Docker to ECR:
   ```
   aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin 967807252336.dkr.ecr.us-east-1.amazonaws.com
   ```
2. Build the image (the Dockerfile expects to be built from the repo root):
   ```
   docker build -t capiro-api -f apps/api/Dockerfile .
   ```
3. Tag and push:
   ```
   docker tag capiro-api:latest 967807252336.dkr.ecr.us-east-1.amazonaws.com/capiro/dev/api:latest
   docker push 967807252336.dkr.ecr.us-east-1.amazonaws.com/capiro/dev/api:latest
   ```

### Step 2: Run Prisma migration on AWS
Run the existing migration ECS task. The task definition is `capiro-dev-api-admin-migrate:1`.

Use `aws ecs run-task` with:
- cluster: capiro-dev
- taskDefinition: capiro-dev-api-admin-migrate:1
- networkConfiguration: awsvpcConfiguration with subnets [subnet-0e38bd390f8961fef, subnet-0920665f91c905f01, subnet-06db79cd21239de19], securityGroups [sg-01def4e5c0fe44d4a], assignPublicIp DISABLED
- launchType: FARGATE
- count: 1

After launching, wait for the task to complete and check the logs. Use `aws ecs describe-tasks` to poll status.

### Step 3: Seed the workflow template
After migration succeeds, we need to run the seed script. This needs database access.

Option A: Run a one-off ECS task that executes the seed script.
Option B: If there's a way to exec into the running API container, run it there.

For option A, run the api-admin-migrate task again but override the command to run the seed:
```
aws ecs run-task --cluster capiro-dev --task-definition capiro-dev-api-admin-migrate:1 \
  --network-configuration "awsvpcConfiguration={subnets=[subnet-0e38bd390f8961fef,subnet-0920665f91c905f01,subnet-06db79cd21239de19],securityGroups=[sg-01def4e5c0fe44d4a],assignPublicIp=DISABLED}" \
  --launch-type FARGATE \
  --overrides '{"containerOverrides":[{"name":"api-admin-migrate","command":["sh","-c","ENCODED_PASSWORD=$(node -e \"process.stdout.write(encodeURIComponent(process.argv[1]))\" \"$DB_PASSWORD\") && export DATABASE_URL=\"postgresql://${DB_USER}:${ENCODED_PASSWORD}@${DB_HOST}:${DB_PORT}/${DB_NAME}?schema=public&sslmode=require\" && npx ts-node prisma/seed-workflows.ts"]}]}' \
  --region us-east-1
```

If the seed command format doesn't work, try: `npx tsx prisma/seed-workflows.ts` or `node -e "require('./prisma/seed-workflows.ts')"` — check what's available in the container.

## IMPORTANT
- Check the Dockerfile FIRST to understand the build process and what tools are available in the container.
- If Docker desktop is not running or docker build fails, report back with the error — don't try to install Docker.
- Poll task status every 15 seconds until STOPPED. Check the stopCode for success/failure.
- Report any errors in full.
