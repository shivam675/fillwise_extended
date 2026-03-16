import logging
import shutil
from docx import Document
from typing import Dict

logger = logging.getLogger(__name__)


class DocxRenderer:
    def render(self, template_path: str, replacements: Dict[str, str], output_path: str) -> str:
        shutil.copy2(template_path, output_path)
        doc = Document(output_path)
        count = 0

        for para in doc.paragraphs:
            for ph, val in replacements.items():
                if ph in "".join(r.text for r in para.runs):
                    if self._replace_in_para(para, ph, val):
                        count += 1

        for table in doc.tables:
            for row in table.rows:
                for cell in row.cells:
                    for para in cell.paragraphs:
                        for ph, val in replacements.items():
                            if ph in "".join(r.text for r in para.runs):
                                if self._replace_in_para(para, ph, val):
                                    count += 1

        doc.save(output_path)
        logger.info(f"Rendered {count} replacements into {output_path}")
        return output_path

    def _replace_in_para(self, para, placeholder: str, replacement: str) -> bool:
        """Replace placeholder in paragraph preserving run-level formatting."""
        replaced = False
        # Keep iterating in case same placeholder appears multiple times
        while True:
            run_texts = [r.text for r in para.runs]
            full = "".join(run_texts)
            if placeholder not in full:
                break

            ph_start = full.index(placeholder)
            ph_end = ph_start + len(placeholder)

            # Build run boundaries
            boundaries = []
            pos = 0
            for i, rt in enumerate(run_texts):
                boundaries.append((pos, pos + len(rt), i))
                pos += len(rt)

            s_run = e_run = s_off = e_off = None
            for r_start, r_end, r_idx in boundaries:
                if r_start <= ph_start < r_end and s_run is None:
                    s_run, s_off = r_idx, ph_start - r_start
                if r_start < ph_end <= r_end and e_run is None:
                    e_run, e_off = r_idx, ph_end - r_start

            if s_run is None:
                break

            # Placeholder ends exactly at boundary of last run
            if e_run is None:
                e_run = len(para.runs) - 1
                e_off = len(run_texts[e_run])

            runs = para.runs
            if s_run == e_run:
                old = runs[s_run].text
                runs[s_run].text = old[:s_off] + replacement + old[e_off:]
            else:
                runs[s_run].text = run_texts[s_run][:s_off] + replacement
                for i in range(s_run + 1, e_run):
                    runs[i].text = ""
                runs[e_run].text = run_texts[e_run][e_off:]

            replaced = True

        return replaced
