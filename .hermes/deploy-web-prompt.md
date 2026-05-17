TASK: Build and push the Capiro web Docker image, then force-deploy the web ECS service.

## CONTEXT
- AWS Account: 967807252336
- Region: us-east-1
- ECR Web Repo: capiro/dev/web
- ECS Cluster: capiro-dev
- ECS Web Service: capiro-dev-web
- The `aws` CLI is authenticated locally as `capirocli`
- Docker Desktop is running
- The Dockerfile is at apps/web/Dockerfile
- Build from the repo root directory

## STEPS

### Step 1: Authenticate Docker to ECR
```
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin 967807252336.dkr.ecr.us-east-1.amazonaws.com
```

### Step 2: Build the web image
The Dockerfile uses multi-stage: node for build, nginx for runtime. Build for linux/arm64 to match Fargate:
```
docker buildx build --platform linux/arm64 -f apps/web/Dockerfile -t 967807252336.dkr.ecr.us-east-1.amazonaws.com/capiro/dev/web:latest --push .
```
This builds AND pushes in one step.

### Step 3: Force new deployment of the web service
```
aws ecs update-service --cluster capiro-dev --service capiro-dev-web --force-new-deployment --region us-east-1
```

### Step 4: Verify
Check the API service deployment is also progressing (we force-deployed it earlier):
```
aws ecs describe-services --cluster capiro-dev --services capiro-dev-api capiro-dev-web --region us-east-1 --query 'services[*].{name: serviceName, status: status, running: runningCount, desired: desiredCount}'
```

Report the final status of both services.
