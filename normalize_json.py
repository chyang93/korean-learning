import argparse
import json
import re
from pathlib import Path


PART_FILENAME_RE = re.compile(r"part-(\d+)\.json$", re.IGNORECASE)
TITLE_PREFIX_RE = re.compile(r"^\s*#\d+")


def sync_internal_data(file_path: Path, dry_run: bool = False) -> bool:
	"""Sync id/part/title prefix in one JSON file using its filename as truth."""
	match = PART_FILENAME_RE.search(file_path.name)
	if not match:
		return False

	correct_id = int(match.group(1))

	try:
		content = json.loads(file_path.read_text(encoding="utf-8"))
	except json.JSONDecodeError:
		print(f"[SKIP] JSON 格式錯誤: {file_path.name}")
		return False

	def update_item(item: dict, target_id: int) -> dict:
		if not isinstance(item, dict):
			return item

		item["id"] = target_id
		if "part" in item:
			item["part"] = target_id

		if isinstance(item.get("title"), str):
			title = item["title"]
			if TITLE_PREFIX_RE.match(title):
				item["title"] = TITLE_PREFIX_RE.sub(f"#{target_id}", title)

		return item

	if isinstance(content, list):
		content = [update_item(obj, correct_id) for obj in content]
	elif isinstance(content, dict):
		content = update_item(content, correct_id)
	else:
		print(f"[SKIP] 非預期 JSON 根節點型別: {file_path.name}")
		return False

	if dry_run:
		print(f"[DRY-RUN] {file_path.name} -> id/part/title 前綴同步為 {correct_id}")
		return True

	file_path.write_text(
		json.dumps(content, ensure_ascii=False, indent=2) + "\n",
		encoding="utf-8",
	)
	print(f"[OK] {file_path.name} -> id/part/title 前綴同步為 {correct_id}")
	return True


def iter_part_files(source_dir: Path):
	# Only target part-*.json to avoid touching manifest or unrelated JSON files.
	for file_path in sorted(source_dir.glob("part-*.json")):
		if file_path.is_file() and PART_FILENAME_RE.search(file_path.name):
			yield file_path


def main():
	parser = argparse.ArgumentParser(description="依檔名同步 part JSON 內部編號")
	parser.add_argument(
		"--source-dir",
		default="./data/grammar",
		help="JSON 檔案資料夾路徑，預設為 ./data/grammar",
	)
	parser.add_argument(
		"--dry-run",
		action="store_true",
		help="僅顯示將修改的檔案，不寫回",
	)
	args = parser.parse_args()

	source_dir = Path(args.source_dir)
	if not source_dir.exists() or not source_dir.is_dir():
		print(f"[ERROR] 找不到資料夾: {source_dir}")
		return

	total = 0
	changed = 0
	for file_path in iter_part_files(source_dir):
		total += 1
		if sync_internal_data(file_path, dry_run=args.dry_run):
			changed += 1

	mode = "模擬" if args.dry_run else "實際"
	print(f"\n完成({mode})：掃描 {total} 檔，處理 {changed} 檔")


if __name__ == "__main__":
	main()
