# Checks the two things sw.js needs by hand before FindNotes can work offline. Run:
#   python check.py          to see what's wrong
#   python check.py --fix    to add missing files to sw.js and bump VERSION for you
# serve.py runs it each time it starts, and GitHub runs it on every push.
#
# 1. Every file of the app is in SHELL, the list sw.js saves on the phone. A file left out
#    works while you're online and breaks the moment you're not.
# 2. VERSION has changed whenever an app file has. Phones only look for an update when sw.js
#    itself changes, so without a new VERSION they keep the old app forever.
import argparse
import pathlib
import re
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent
SW = ROOT / "sw.js"

# Files in this folder that are not part of the app on the phone.
NOT_CACHED = {"sw.js", "serve.py", "check.py", "CNAME", "README.md"}

SHELL_RE = re.compile(r"const SHELL = \[\n(.*?)\n\];", re.S)
VERSION_RE = re.compile(r"const VERSION = '([^']+)';")


def app_files():
    files = set()
    for path in ROOT.rglob("*"):
        rel = path.relative_to(ROOT).as_posix()
        if path.is_file() and not any(part.startswith(".") for part in rel.split("/")) and rel not in NOT_CACHED:
            files.add(rel)
    return files


def shell_entries(sw):
    return re.findall(r"'([^']+)'", SHELL_RE.search(sw).group(1))


def git(*args):
    result = subprocess.run(["git", *args], cwd=ROOT, capture_output=True, text=True)
    return result.stdout if result.returncode == 0 else None


def default_base():
    # Compare with what's live (origin/main), or with the last commit when you are on it already.
    if git("rev-parse", "--verify", "--quiet", "origin/main") and git("merge-base", "HEAD", "origin/main"):
        return git("merge-base", "HEAD", "origin/main").strip()
    return "HEAD"


def changed_since(base, cached):
    # Committed and not yet committed changes alike, so it catches them before you push.
    out = git("diff", "--name-only", base, "--", ".")
    if out is None:
        return None
    return sorted(set(out.split()) & cached)


def bump(version):
    parts = version.split(".")
    parts[-1] = str(int(parts[-1]) + 1)
    return ".".join(parts)


def main():
    parser = argparse.ArgumentParser(description="Check that sw.js is ready to ship.")
    parser.add_argument("--fix", action="store_true", help="add missing files and bump VERSION")
    parser.add_argument("--base", help="git commit to compare with (default: origin/main)")
    args = parser.parse_args()

    sw = SW.read_text()
    listed = shell_entries(sw)
    on_disk = app_files()
    missing = sorted(on_disk - set(listed))
    gone = [entry for entry in listed if entry != "./" and entry not in on_disk]
    problems = []

    if missing:
        problems.append("Not saved for offline use (add to SHELL in sw.js): " + ", ".join(missing))
    if gone:
        problems.append("Listed in SHELL but not in the folder, so the app can't install: " + ", ".join(gone))

    version = VERSION_RE.search(sw).group(1)
    base = args.base or default_base()
    old_sw = git("show", f"{base}:sw.js")
    changed = changed_since(base, set(listed) | on_disk) if old_sw else None
    # Only one bump per release: once VERSION differs from the base, more changes can ride along.
    same_version = old_sw is not None and VERSION_RE.search(old_sw).group(1) == version
    needs_bump = same_version and bool(changed or missing)
    if same_version and changed:
        problems.append(f"Changed since {base[:7]} but VERSION is still {version}: " + ", ".join(changed))

    if args.fix and (missing or gone or needs_bump):
        entries = [entry for entry in listed if entry not in gone] + missing
        sw = SHELL_RE.sub(lambda _: "const SHELL = [\n" + "\n".join(f"  '{e}'," for e in entries) + "\n];", sw)
        if needs_bump:
            sw = VERSION_RE.sub(f"const VERSION = '{bump(version)}';", sw)
            print(f"VERSION {version} -> {bump(version)}")
        SW.write_text(sw)
        print("Updated sw.js." + (f" Added: {', '.join(missing)}." if missing else "")
              + (f" Removed: {', '.join(gone)}." if gone else ""))
        return 0

    if problems:
        print("sw.js needs attention:")
        for problem in problems:
            print("  - " + problem)
        print("Run  python check.py --fix  to sort it out.")
        return 1
    print(f"sw.js is ready: {len(listed)} files saved for offline use, VERSION {version}.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
