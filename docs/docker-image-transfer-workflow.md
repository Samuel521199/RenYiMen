# Docker Image Transfer Workflow

This project currently uses a local-build, tar-export, manual-upload deployment flow.
Use this note as the reference when generating code or preparing deployment steps.

## When This Flow Applies

- Local machine builds Docker images.
- Images are exported as `.tar` files.
- The operator manually uploads the `.tar` files to the server, usually under `/opt/workflow/`.
- The server loads the uploaded images and restarts the relevant compose services.
- Codex should not upload files to the server unless explicitly asked.

## Local Machine

Run from the project root:

```powershell
cd D:\Projects\WorkFlow
```

Build the images:

```powershell
docker compose build web workbench-backend
```

Confirm the actual image names:

```powershell
docker images | findstr /i "workflow web workbench"
```

Export the images. Adjust image names if `docker images` shows different names:

```powershell
docker save workflow-web:latest -o workflow-web.tar
docker save workflow-workbench-backend:latest -o workbench-backend.tar
```

Common alternate backend image names may include compose-generated variants such as
`workflow_workbench-backend`. Always use the actual name shown by `docker images`.

## Upload Step

Upload the generated files to the server, for example:

```text
/opt/workflow/workflow-web.tar
/opt/workflow/workbench-backend.tar
```

The upload is a manual/operator step unless requested otherwise.

## Server

Run from the server project/deploy directory, for example:

```bash
cd /opt/workflow
```

Load the images:

```bash
docker load -i workflow-web.tar
docker load -i workbench-backend.tar
```

Restart the updated services:

```bash
docker compose up -d web workbench-backend
```

Check status and logs:

```bash
docker compose ps
docker compose logs --tail=100 web workbench-backend
```

## Important Notes

- If frontend code changes, rebuild and export `web`; otherwise the running Docker page will still show old UI.
- If Workbench backend code changes, rebuild and export `workbench-backend`.
- If only environment variables change on the server, image rebuild is usually not required; restart affected services after updating `.env`.
- For local Docker testing, access the web service at `http://localhost:3001` unless `WEB_PORT` is changed.
- Do not rely on `docker compose up -d` alone to pick up source changes already baked into an image. Rebuild first, then export and load.
