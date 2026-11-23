"""Stream RAR/7z members using the OS libarchive. Entry names are never used as disk paths."""
import ctypes as c
import ctypes.util
import json
import locale
import os
import re
import shutil
import subprocess
import sys
import zlib
from datetime import datetime


def emit(**fields):
    print(json.dumps(fields, ensure_ascii=True), flush=True)


def unrar_path():
    exe = shutil.which("unrar")
    if not exe and os.name == "nt":
        exe = os.path.join(os.environ.get("ProgramFiles", "C:/Program Files"), "WinRAR", "UnRAR.exe")
    return exe if exe and os.path.isfile(exe) else None


def list_rar_records(volumes):
    # Windows libarchive lacks solid RAR support and may stop at the first RAR5
    # volume. Use one decompressed stream and verify each boundary against its CRC.
    exe = unrar_path()
    if not exe or not os.path.isfile(exe):
        raise RuntimeError("Multi-volume RAR requires UnRAR. Install it or scan a materialised collection.")
    env = dict(os.environ, LC_ALL="C", LANG="C")
    params = dict(stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, env=env)
    with subprocess.Popen([exe, "lt", "-v", "-scur", "-p-", "-c-", volumes[0]], **params) as listing:
        try:
            data = listing.stdout.read(32 * 1024**2 + 1)
            if len(data) > 32 * 1024**2 or listing.wait():
                raise ValueError("Invalid or oversized RAR volume list")
        finally:
            if listing.poll() is None:
                listing.kill()
    text = data.decode("utf-16le" if b"\0" in data[:64] else "utf-8").replace("\r", "").lstrip("\ufeff")
    records = []
    total = 0
    limit = min(8 * 1024**3, max(64 * 1024**2, sum(os.stat(v).st_size for v in volumes) * 200))
    for block in re.split(r"\n[ \t]*\n", text):
        fields = {}
        for line in block.splitlines():
            label, sep, value = line.strip().partition(": ")
            if sep:
                fields[label] = value.strip()
        name = fields.get("Name") or fields.get("Nazwa")
        if not name:
            continue
        kind = (fields.get("Type") or fields.get("Typ") or "").lower()
        if kind in {"directory", "folder", "katalog"}:
            continue
        if kind not in {"file", "plik"}:
            raise ValueError("Unsupported RAR member type " + kind)
        if "Pack-CRC32" in fields or any(v in ("-->", "<->") for v in fields.values()):
            continue
        size = int(fields.get("Size", fields.get("Rozmiar", "-1")))
        check = fields.get("CRC32", "")
        if size < 0 or size > 512 * 1024**2 or not re.fullmatch(r"[a-fA-F0-9]{8}", check):
            raise ValueError("Missing CRC or unsupported RAR member size: " + name)
        total += size
        if total > limit or len(records) >= 100000:
            raise ValueError("RAR exceeds expanded size or entry count limit")
        stamp = 0
        date = fields.get("mtime") or fields.get("Modified") or fields.get("Zmieniony")
        if date:
            try:
                # UnRAR's technical listing uses local time unless an offset is present.
                stamp = int(datetime.fromisoformat(date.replace(",", ".")).timestamp() * 1000)
            except ValueError:
                pass
        records.append((name, size, int(check, 16), stamp))
    if not records:
        raise ValueError("No RAR file records recognised (expected English or Polish technical listing)")
    return exe, params, records


def read_rar_volumes(target, volumes, roster):
    exe, params, records = roster
    with subprocess.Popen([exe, "p", "-inul", "-p-", "-y", "-c-", volumes[0]], **params) as proc:
        try:
            for name, size, checksum, stamp in records:
                emit(name=name, size=size, mtimeMs=stamp, directory=False)
                response = sys.stdin.buffer.readline()
                if response not in (b"r\n", b"s\n"):
                    return
                out = open(target, "xb") if response == b"r\n" else None
                remaining, actual = size, 0
                try:
                    while remaining:
                        chunk = proc.stdout.read(min(remaining, 131072))
                        if not chunk:
                            raise ValueError("Incomplete multi-volume RAR member: " + name)
                        remaining -= len(chunk)
                        actual = zlib.crc32(chunk, actual)
                        if out:
                            out.write(chunk)
                finally:
                    if out:
                        out.close()
                if actual != checksum:
                    raise ValueError("CRC mismatch in RAR member: " + name)
                if out:
                    emit(ready=True)
                    if sys.stdin.buffer.readline() != b"n\n":
                        return
                    os.unlink(target)
            if proc.stdout.read(1) or proc.wait():
                raise ValueError("Unexpected end or extra bytes in RAR volume set")
            emit(end=True)
        finally:
            if proc.poll() is None:
                proc.kill()


def main():
    target, *volumes = sys.argv[1:]
    with open(volumes[0], "rb") as archive:
        is_rar = archive.read(6) == b"Rar!\x1a\x07"
    if is_rar and (len(volumes) > 1 or unrar_path()):
        try:
            roster = list_rar_records(volumes)
        except (OSError, ValueError):
            # Single archives with non-CRC digests or an unsupported UnRAR listing
            # can still be read by libarchive. No entry has been published yet.
            if len(volumes) > 1:
                raise
        else:
            read_rar_volumes(target, volumes, roster)
            return
    locale.setlocale(locale.LC_CTYPE, "")
    dll = (os.path.join(os.environ["SystemRoot"], "System32", "archiveint.dll")
           if os.name == "nt" else ctypes.util.find_library("archive"))
    if not dll:
        raise RuntimeError("system libarchive was not found")
    lib = c.CDLL(dll)
    ptr, char, num = c.c_void_p, c.c_char_p, c.c_int

    def bind(name, result, *args):
        fn = getattr(lib, name)
        fn.restype, fn.argtypes = result, args
        return fn

    new = bind("archive_read_new", ptr)
    free = bind("archive_read_free", num, ptr)
    messages = bind("archive_error_string", char, ptr)
    next_entry = bind("archive_read_next_header", num, ptr, c.POINTER(ptr))
    entry_name = bind("archive_entry_pathname_w", c.c_wchar_p, ptr)
    raw_name = bind("archive_entry_pathname", char, ptr)
    read = bind("archive_read_data", c.c_ssize_t, ptr, ptr, c.c_size_t)
    skip = bind("archive_read_data_skip", num, ptr)
    entry_size = bind("archive_entry_size", c.c_int64, ptr)
    mtime = bind("archive_entry_mtime", c.c_int64 if os.name == "nt" else c.c_long, ptr)
    mode = bind("archive_entry_filetype", c.c_uint, ptr)
    hardlink = bind("archive_entry_hardlink", char, ptr)
    encrypted = bind("archive_entry_is_encrypted", num, ptr)
    a = new()
    if not a:
        raise MemoryError("cannot allocate archive reader")

    def checked(code):
        if code < 0:
            raise ValueError((messages(a) or b"libarchive error").decode(errors="replace"))

    try:
        for fmt in ["rar", "rar5", "7zip"]:
            checked(bind("archive_read_support_format_" + fmt, num, ptr)(a))
        if os.name == "nt" and len(volumes) == 1:
            checked(bind("archive_read_open_filename_w", num, ptr, c.c_wchar_p, c.c_size_t)(a, volumes[0], 131072))
        else:
            encoded = [p.encode("mbcs") if os.name == "nt" else os.fsencode(p) for p in volumes]
            names = (char * (len(encoded) + 1))(*encoded, None)
            checked(bind("archive_read_open_filenames", num, ptr, c.POINTER(char), c.c_size_t)(a, names, 131072))
        e, buf = ptr(), c.create_string_buffer(131072)
        total, records = 0, 0
        limit = min(8 * 1024**3, max(64 * 1024**2, sum(os.stat(v).st_size for v in volumes) * 200))
        while True:
            status = next_entry(a, c.byref(e))
            if status == 1:
                break
            checked(status)
            records += 1
            size = entry_size(e)
            total += max(0, size)
            if records > 100000 or total > limit:
                raise ValueError("Archive exceeds entry count or expanded byte limit")
            name = entry_name(e) or os.fsdecode(raw_name(e) or b"")
            kind = mode(e)
            problem = ("Encrypted archive member" if encrypted(e) else "Link or special archive member"
                       if kind not in (0o100000, 0o040000) or hardlink(e) else
                       "Invalid archive member size" if size < 0 or size > 512 * 1024**2 else None)
            emit(name=name, size=size, mtimeMs=mtime(e) * 1000, directory=kind == 0o040000, problem=problem)
            command = sys.stdin.buffer.readline()
            if command == b"r\n" and not problem:
                written = 0
                with open(target, "xb") as out:
                    while True:
                        n = read(a, buf, len(buf))
                        checked(n)
                        if not n:
                            break
                        written += n
                        if written > size:
                            raise ValueError("Archive member exceeds declared size")
                        out.write(buf.raw[:n])
                if written != size:
                    raise ValueError("Archive member has incorrect size")
                emit(ready=True)
                if sys.stdin.buffer.readline() != b"n\n":
                    return
                os.unlink(target)
            elif command != b"s\n":
                return
            checked(skip(a))
        emit(end=True)
    finally:
        free(a)


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        emit(error=str(exc))
        sys.exit(1)
