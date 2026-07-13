# AI Image Workbench Deployment

## Files
- `ai-workbench-code-YYYYMMDD.tar.gz`: application code and deployment files.
- `ai-workbench-data-YYYYMMDD.tar.gz`: `storage/` files and database backup.

## Basic Steps
1. Extract the code package on the server.
2. Copy `.env.example` to `.env` and fill production values.
3. Extract the data package into the project root.
4. Start services with `docker-compose -f docker-compose.prod.yml up -d --build`.
5. Restore the database backup if needed.
6. Edit `fix_urls.sql`, replace `YOUR_SERVER_IP`, then run it if URLs need rewriting.

