-- 部署后执行，将 YOUR_SERVER_IP 替换为实际公网 IP 后再运行

UPDATE final_images
SET image_url = REPLACE(image_url, 'http://localhost:8000', 'http://YOUR_SERVER_IP:8000')
WHERE image_url LIKE 'http://localhost:8000%';

UPDATE video_jobs
SET export_url = REPLACE(export_url, 'http://localhost:8000', 'http://YOUR_SERVER_IP:8000')
WHERE export_url LIKE 'http://localhost:8000%';

UPDATE video_drafts
SET video_url = REPLACE(video_url, 'http://localhost:8000', 'http://YOUR_SERVER_IP:8000')
WHERE video_url LIKE 'http://localhost:8000%';

SELECT 'final_images' as tbl, COUNT(*) FROM final_images WHERE image_url LIKE '/static%'
UNION ALL
SELECT 'video_jobs', COUNT(*) FROM video_jobs WHERE export_url IS NOT NULL
UNION ALL
SELECT 'video_drafts', COUNT(*) FROM video_drafts WHERE video_url IS NOT NULL;
