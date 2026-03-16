import subprocess
import logging
import os
from pathlib import Path

logger = logging.getLogger(__name__)


class PdfConverter:
    def convert(self, docx_path: str, output_dir: str) -> str:
        env = {**os.environ, "HOME": "/tmp/lo_home"}
        Path("/tmp/lo_home").mkdir(exist_ok=True)

        result = subprocess.run(
            [
                "libreoffice",
                "--headless",
                "--norestore",
                "--convert-to",
                "pdf",
                "--outdir",
                output_dir,
                docx_path,
            ],
            capture_output=True,
            text=True,
            timeout=120,
            env=env,
        )

        if result.returncode != 0:
            raise RuntimeError(f"LibreOffice failed: {result.stderr}")

        stem = Path(docx_path).stem
        pdf = Path(output_dir) / f"{stem}.pdf"
        if not pdf.exists():
            raise FileNotFoundError(f"PDF not found at {pdf}")

        logger.info(f"PDF created: {pdf}")
        return str(pdf)
