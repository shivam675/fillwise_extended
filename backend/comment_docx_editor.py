"""Apply comment-based edits into DOCX with tracked changes."""

import copy
import datetime
import io
import re
import zipfile
from lxml import etree

W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"


def _w(tag: str) -> str:
    return f"{{{W}}}{tag}"


AUTHOR = "AI Editor"
EDIT_DATE = datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")


def apply_edits_and_save(all_files: dict, edits: list[dict], resolve_comment_ids: list[str] | None, output_path: str) -> None:
    doc_xml_bytes = all_files["word/document.xml"]
    root = etree.fromstring(doc_xml_bytes)

    edits_by_id = {
        e["comment_id"]: {
            "new_text": e["new_text"],
            "replace_scope": e.get("replace_scope", "anchor"),
        }
        for e in edits
    }

    change_id_ctr = [_find_max_change_id(root) + 1]

    body = root.find(f".//{_w('body')}")
    if body is None:
        raise ValueError("No <w:body> found in document.xml")

    paragraphs = list(body.findall(f".//{_w('p')}"))
    for para in paragraphs:
        _process_paragraph(para, edits_by_id, change_id_ctr)

    new_doc_xml = etree.tostring(root, xml_declaration=True, encoding="UTF-8", standalone=True)
    all_files["word/document.xml"] = new_doc_xml

    if resolve_comment_ids:
        _resolve_comments(all_files, [str(cid) for cid in resolve_comment_ids])

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zout:
        for name, data in all_files.items():
            zout.writestr(name, data)
    buf.seek(0)

    with open(output_path, "wb") as f:
        f.write(buf.read())


def _resolve_comments(all_files: dict, comment_ids: list[str]) -> None:
    if not comment_ids:
        return

    comment_ids_set = set(comment_ids)

    for part in ("word/document.xml", "word/footnotes.xml", "word/endnotes.xml"):
        xml_bytes = all_files.get(part)
        if not xml_bytes:
            continue
        all_files[part] = _remove_comment_refs_from_story(xml_bytes, comment_ids_set)

    removed_para_ids: set[str] = set()
    comments_xml = all_files.get("word/comments.xml")
    if comments_xml:
        new_comments_xml, removed_para_ids = _remove_comments_from_comments_part(comments_xml, comment_ids_set)
        all_files["word/comments.xml"] = new_comments_xml

    if removed_para_ids and all_files.get("word/commentsExtended.xml"):
        all_files["word/commentsExtended.xml"] = _remove_extended_comments(
            all_files["word/commentsExtended.xml"],
            removed_para_ids,
        )


def _remove_comment_refs_from_story(xml_bytes: bytes, comment_ids: set[str]) -> bytes:
    root = etree.fromstring(xml_bytes)
    targets = {"commentRangeStart", "commentRangeEnd", "commentReference"}

    for el in list(root.iter()):
        tag = etree.QName(el.tag).localname if el.tag else ""
        if tag not in targets:
            continue
        cid = el.get(_w("id"))
        if cid in comment_ids:
            parent = el.getparent()
            if parent is not None:
                parent.remove(el)

    return etree.tostring(root, xml_declaration=True, encoding="UTF-8", standalone=True)


def _remove_comments_from_comments_part(xml_bytes: bytes, comment_ids: set[str]) -> tuple[bytes, set[str]]:
    root = etree.fromstring(xml_bytes)
    removed_para_ids: set[str] = set()

    for comment_el in list(root):
        tag = etree.QName(comment_el.tag).localname if comment_el.tag else ""
        if tag != "comment":
            continue
        cid = comment_el.get(_w("id"))
        if cid in comment_ids:
            for attr_name, attr_val in comment_el.attrib.items():
                if attr_name.endswith("}paraId") and attr_val:
                    removed_para_ids.add(attr_val)
            root.remove(comment_el)

    return etree.tostring(root, xml_declaration=True, encoding="UTF-8", standalone=True), removed_para_ids


def _remove_extended_comments(xml_bytes: bytes, para_ids: set[str]) -> bytes:
    root = etree.fromstring(xml_bytes)
    for el in list(root):
        tag = etree.QName(el.tag).localname if el.tag else ""
        if tag != "commentEx":
            continue
        hit = False
        for attr_name, attr_val in el.attrib.items():
            if attr_name.endswith("}paraId") and attr_val in para_ids:
                hit = True
                break
        if hit:
            root.remove(el)
    return etree.tostring(root, xml_declaration=True, encoding="UTF-8", standalone=True)


def _find_max_change_id(root) -> int:
    max_id = 0
    attr = "{%s}id" % W
    for el in root.iter():
        val = el.get(attr)
        if val and val.isdigit():
            max_id = max(max_id, int(val))
    return max_id


def _process_paragraph(para, edits_by_id: dict, change_id_ctr: list):
    items = list(para.iter())
    open_starts: dict[str, int] = {}
    ranges = []

    for i, el in enumerate(items):
        local = etree.QName(el.tag).localname if el.tag else ""
        if local == "commentRangeStart":
            cid = el.get(_w("id"))
            if cid and cid in edits_by_id:
                open_starts[cid] = i
        elif local == "commentRangeEnd":
            cid = el.get(_w("id"))
            if cid and cid in open_starts:
                ranges.append((cid, open_starts.pop(cid), i))

    if not ranges:
        return

    for cid, start_i, end_i in reversed(ranges):
        edit_meta = edits_by_id[cid]
        new_text = edit_meta["new_text"]
        replace_scope = edit_meta.get("replace_scope", "anchor")

        if replace_scope == "paragraph":
            run_elements = _collect_text_runs_in_paragraph(para)
            if not run_elements:
                continue
            _replace_runs_with_tracked_change(para, run_elements, new_text, change_id_ctr)
            break

        run_elements = []
        for i in range(start_i + 1, end_i):
            if etree.QName(items[i].tag).localname == "r":
                if items[i].getparent() is not None:
                    run_elements.append(items[i])

        if not run_elements:
            continue

        run_elements = _expand_run_word_boundaries(run_elements)
        _replace_runs_with_tracked_change(para, run_elements, new_text, change_id_ctr)


def _collect_text_runs_in_paragraph(para):
    runs = []
    for r_el in para.findall(f".//{_w('r')}"):
        if r_el.getparent() is None:
            continue
        has_text = bool(r_el.findall(f".//{_w('t')}")) or bool(r_el.findall(f".//{_w('delText')}"))
        if has_text:
            runs.append(r_el)
    return runs


def _run_text(run_el) -> str:
    parts = []
    for el in run_el.findall(f".//{_w('t')}"):
        parts.append(el.text or "")
    for el in run_el.findall(f".//{_w('delText')}"):
        parts.append(el.text or "")
    return "".join(parts)


def _is_word_char(ch: str) -> bool:
    return bool(ch and re.match(r"[A-Za-z0-9]", ch))


def _expand_run_word_boundaries(run_elements: list):
    if not run_elements:
        return run_elements

    selected = list(run_elements)

    while selected:
        first = selected[0]
        first_parent = first.getparent()
        if first_parent is None:
            break
        siblings = list(first_parent)
        idx = siblings.index(first)
        if idx == 0:
            break

        prev = siblings[idx - 1]
        if etree.QName(prev.tag).localname != "r":
            break

        prev_text = _run_text(prev)
        first_text = _run_text(first)
        if not prev_text or not first_text:
            break
        if _is_word_char(prev_text[-1]) and _is_word_char(first_text[0]):
            if prev.getparent() is not None and prev not in selected:
                selected.insert(0, prev)
                continue
        break

    while selected:
        last = selected[-1]
        last_parent = last.getparent()
        if last_parent is None:
            break
        siblings = list(last_parent)
        idx = siblings.index(last)
        if idx >= len(siblings) - 1:
            break

        nxt = siblings[idx + 1]
        if etree.QName(nxt.tag).localname != "r":
            break

        last_text = _run_text(last)
        next_text = _run_text(nxt)
        if not last_text or not next_text:
            break
        if _is_word_char(last_text[-1]) and _is_word_char(next_text[0]):
            if nxt.getparent() is not None and nxt not in selected:
                selected.append(nxt)
                continue
        break

    return selected


def _replace_runs_with_tracked_change(para, run_elements, new_text, change_id_ctr):
    first_live_run = run_elements[0]
    parent = first_live_run.getparent()
    if parent is None:
        return

    insertion_idx = list(parent).index(first_live_run)

    rpr_el = first_live_run.find(_w("rPr"))
    rpr_copy = copy.deepcopy(rpr_el) if rpr_el is not None else None

    del_id = change_id_ctr[0]
    change_id_ctr[0] += 1
    ins_id = change_id_ctr[0]
    change_id_ctr[0] += 1

    del_el = etree.Element(_w("del"), {
        _w("id"): str(del_id),
        _w("author"): AUTHOR,
        _w("date"): EDIT_DATE,
    })

    for r_el in run_elements:
        r_parent = r_el.getparent()
        if r_parent is not None:
            orig_run = copy.deepcopy(r_el)
            for t_el in orig_run.findall(f".//{_w('t')}"):
                dt_el = etree.Element(_w("delText"))
                dt_el.text = t_el.text
                if (t_el.text or "").startswith(" ") or (t_el.text or "").endswith(" "):
                    dt_el.set("{http://www.w3.org/XML/1998/namespace}space", "preserve")

                t_parent = t_el.getparent()
                t_idx = list(t_parent).index(t_el)
                t_parent.remove(t_el)
                t_parent.insert(t_idx, dt_el)

            del_el.append(orig_run)
            r_parent.remove(r_el)

    if not len(del_el):
        return

    ins_el = etree.Element(_w("ins"), {
        _w("id"): str(ins_id),
        _w("author"): AUTHOR,
        _w("date"): EDIT_DATE,
    })
    new_run = etree.Element(_w("r"))
    if rpr_copy is not None:
        new_run.append(rpr_copy)
    new_t = etree.Element(_w("t"))
    new_t.text = new_text
    if new_text.startswith(" ") or new_text.endswith(" "):
        new_t.set("{http://www.w3.org/XML/1998/namespace}space", "preserve")
    new_run.append(new_t)
    ins_el.append(new_run)

    parent.insert(insertion_idx, del_el)
    parent.insert(insertion_idx + 1, ins_el)
