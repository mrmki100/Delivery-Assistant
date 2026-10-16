"""Tests package for Driver and Update Assistant."""

import sys
from pathlib import Path

# Automatically ensure 'src' is in sys.path for test discovery
src_dir = Path(__file__).resolve().parent.parent / "src"
if str(src_dir) not in sys.path:
    sys.path.insert(0, str(src_dir))
