import sys
from pathlib import Path


# Ensure dxcp-api is on sys.path for tests that import modules directly.
DXCP_API_DIR = Path(__file__).resolve().parents[1]
if str(DXCP_API_DIR) not in sys.path:
    sys.path.insert(0, str(DXCP_API_DIR))
