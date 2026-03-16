"""Utilities to parse Word comments and anchors from DOCX files."""

import zipfile
from dataclasses import dataclass
from lxml import etree

NS = {
    "w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
}


def _tag(ns_prefix: str, local: str) -> str:
    return f"{{{NS[ns_prefix]}}}{local}"


@dataclass
class CommentAnchor:
    comment_id: str
    comment_author: str
    comment_date: str
    comment_text: str
    anchored_text: str
    context_snippet: str
    source_part: str
    paragraph_indices: list
    run_indices: list


@dataclass
class DocxParseResult:
    comments: list[CommentAnchor]
    doc_xml: bytes
    comments_xml: bytes
    all_files: dict


def parse_docx_comments(docx_path: str) -> DocxParseResult:
    all_files = {}
    with zipfile.ZipFile(docx_path, "r") as zf:
        for name in zf.namelist():
            all_files[name] = zf.read(name)

    doc_xml = all_files.get("word/document.xml", b"")
    comments_xml = all_files.get("word/comments.xml", b"")

    comments_by_id = _parse_comments_xml(comments_xml) if comments_xml else {}

    story_parts = [
        ("word/document.xml", all_files.get("word/document.xml", b"")),
        ("word/footnotes.xml", all_files.get("word/footnotes.xml", b"")),
        ("word/endnotes.xml", all_files.get("word/endnotes.xml", b"")),
    ]

    anchors: list[CommentAnchor] = []
    for part_name, xml_bytes in story_parts:
        if xml_bytes:
            anchors.extend(_extract_anchors(xml_bytes, comments_by_id, part_name))

    anchored_ids = {a.comment_id for a in anchors}
    for cid, cinfo in comments_by_id.items():
        if cid in anchored_ids:
            continue
        anchors.append(
            CommentAnchor(
                comment_id=cid,
                comment_author=cinfo.get("author", "Unknown"),
                comment_date=cinfo.get("date", ""),
                comment_text=cinfo.get("text", ""),
                anchored_text="",
                context_snippet="",
                source_part="comments-only",
                paragraph_indices=[],
                run_indices=[],
            )
        )

    return DocxParseResult(
        comments=anchors,
        doc_xml=doc_xml,
        comments_xml=comments_xml,
        all_files=all_files,
    )


def _parse_comments_xml(xml_bytes: bytes) -> dict:
    root = etree.fromstring(xml_bytes)
    result = {}
    for comment_el in root.findall(f".//{_tag('w', 'comment')}"):
        cid = comment_el.get(_tag("w", "id"))
        author = comment_el.get(_tag("w", "author"), "Unknown")
        date = comment_el.get(_tag("w", "date"), "")
        texts = comment_el.findall(f".//{_tag('w', 't')}")
        text = " ".join((t.text or "").strip() for t in texts).strip()
        if cid is not None:
            result[cid] = {"author": author, "date": date, "text": text}
    return result


def _extract_anchors(doc_xml: bytes, comments_by_id: dict, source_part: str) -> list[CommentAnchor]:
    root = etree.fromstring(doc_xml)
    body = root.find(f".//{_tag('w', 'body')}")
    if body is None:
        return []

    paragraphs = list(body.findall(f".//{_tag('w', 'p')}"))
    paragraph_texts = [_paragraph_visible_text(p) for p in paragraphs]

    open_ranges: dict[str, dict] = {}
    anchors: list[CommentAnchor] = []
    para_idx = -1

    for elem in body.iter():
        tag = etree.QName(elem.tag).localname if elem.tag else ""

        if tag == "p":
            para_idx += 1
            for cid in list(open_ranges.keys()):
                if open_ranges[cid]["texts"] and not open_ranges[cid]["texts"][-1].endswith("\n"):
                    open_ranges[cid]["texts"].append("\n")

        elif tag == "commentRangeStart":
            cid = elem.get(_tag("w", "id"))
            if cid:
                open_ranges[cid] = {
                    "texts": [],
                    "deleted_texts": [],
                    "para_run_pairs": [],
                    "para_indices": {max(0, para_idx)},
                }

        elif tag == "commentRangeEnd":
            cid = elem.get(_tag("w", "id"))
            if cid and cid in open_ranges:
                info = open_ranges.pop(cid)
                comm_info = comments_by_id.get(cid, {})
                anchored_visible = "".join(info["texts"]).strip()
                anchored_deleted = "".join(info["deleted_texts"]).strip()
                if len(anchored_visible) < 4 and anchored_deleted:
                    if anchored_deleted and anchored_visible and anchored_deleted[-1].isalnum() and anchored_visible[0].isalnum():
                        anchored = f"{anchored_deleted} {anchored_visible}".strip()
                    else:
                        anchored = f"{anchored_deleted}{anchored_visible}".strip()
                else:
                    anchored = anchored_visible

                para_indices = sorted(i for i in info["para_indices"] if i >= 0)
                context_snippet = ""
                if para_indices:
                    first_idx = para_indices[0]
                    if 0 <= first_idx < len(paragraph_texts):
                        context_snippet = paragraph_texts[first_idx]

                anchors.append(
                    CommentAnchor(
                        comment_id=cid,
                        comment_author=comm_info.get("author", "Unknown"),
                        comment_date=comm_info.get("date", ""),
                        comment_text=comm_info.get("text", ""),
                        anchored_text=anchored,
                        context_snippet=context_snippet,
                        source_part=source_part,
                        paragraph_indices=para_indices,
                        run_indices=info["para_run_pairs"],
                    )
                )

        elif tag == "t":
            if open_ranges:
                text = elem.text or ""
                for cid in list(open_ranges.keys()):
                    open_ranges[cid]["texts"].append(text)
                    open_ranges[cid]["para_indices"].add(max(0, para_idx))

        elif tag == "delText":
            if open_ranges:
                text = elem.text or ""
                for cid in list(open_ranges.keys()):
                    open_ranges[cid]["deleted_texts"].append(text)
                    open_ranges[cid]["para_indices"].add(max(0, para_idx))

        elif tag == "tab":
            if open_ranges:
                for cid in list(open_ranges.keys()):
                    open_ranges[cid]["texts"].append("\t")

        elif tag in ("br", "cr"):
            if open_ranges:
                for cid in list(open_ranges.keys()):
                    open_ranges[cid]["texts"].append("\n")

    return anchors


def _paragraph_visible_text(para) -> str:
    parts = []
    for elem in para.iter():
        tag = etree.QName(elem.tag).localname if elem.tag else ""
        if tag == "t":
            parts.append(elem.text or "")
        elif tag == "tab":
            parts.append("\t")
        elif tag in ("br", "cr"):
            parts.append("\n")
    return "".join(parts).strip()
