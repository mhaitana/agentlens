---
"@mhaitana/agentlens": patch
---

Serve the dashboard SPA shell with `Cache-Control: no-store` so a stale cached `index.html` can't reference old asset hashes and 404 across reinstalls/redeploys. Hashed `/assets/*` files are now served `immutable`.