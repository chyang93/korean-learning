import json
import re
from pathlib import Path

# 設定資料夾路徑
GRAMMAR_DIR = Path("./data/grammar")
VOCAB_DIR = Path("./data/vocabulary")

# 用來從檔名提取章節數字的正則表達式 (例如 part-05.json -> 5)
PART_FILENAME_RE = re.compile(r"part-(\d+)\.json$", re.IGNORECASE)

def main():
    print("開始執行單字分配作業...\n")
    
    # 1. 讀取並將文法檔案依據 "part" 分組
    grammar_by_part = {}
    for g_file in sorted(GRAMMAR_DIR.glob("part-*.json")):
        try:
            # 🟢 修正：使用 utf-8-sig 來忽略 BOM 標記
            content = json.loads(g_file.read_text(encoding="utf-8-sig"))
            part_num = content.get("part")
            
            if part_num is not None:
                if part_num not in grammar_by_part:
                    grammar_by_part[part_num] = []
                
                grammar_by_part[part_num].append({
                    "path": g_file,
                    "data": content,
                    "id": content.get("id", 0) # 用來確保排序正確
                })
        except Exception as e:
            print(f"[錯誤] 讀取文法檔 {g_file.name} 失敗: {e}")

    # 將每一章裡面的文法課依據 ID 排序 (確保單字是照順序分配)
    for part_num in grammar_by_part:
        grammar_by_part[part_num].sort(key=lambda x: x["id"])

    # 2. 讀取單字檔案並進行分配
    for v_file in sorted(VOCAB_DIR.glob("part-*.json")):
        match = PART_FILENAME_RE.search(v_file.name)
        if not match:
            continue

        part_num = int(match.group(1))

        # 讀取該章節的所有單字 ID
        try:
            # 🟢 修正：使用 utf-8-sig 來忽略 BOM 標記
            v_content = json.loads(v_file.read_text(encoding="utf-8-sig"))
            vocab_ids = [item["id"] for item in v_content if "id" in item]
        except Exception as e:
            print(f"[錯誤] 讀取單字檔 {v_file.name} 失敗: {e}")
            continue

        # 3. 執行平均分配邏輯
        if part_num in grammar_by_part and grammar_by_part[part_num]:
            g_files = grammar_by_part[part_num]
            num_g = len(g_files)
            num_v = len(vocab_ids)

            base_count = num_v // num_g  # 每個文法課的基本單字數
            remainder = num_v % num_g    # 剩下的單字數 (餘數)

            print(f"👉 章節 Part {part_num}: 共有 {num_v} 個單字，分配給 {num_g} 堂文法課。")

            current_v_idx = 0
            for i, g_info in enumerate(g_files):
                # 前 remainder 個文法課多分 1 個單字
                assign_count = base_count + (1 if i < remainder else 0)

                # 切割單字陣列
                assigned_vocabs = vocab_ids[current_v_idx : current_v_idx + assign_count]
                current_v_idx += assign_count

                # 將分配好的單字寫入文法資料中
                g_info["data"]["relatedVocabIds"] = assigned_vocabs

                # 存檔覆寫 (寫入時維持標準 utf-8 即可)
                g_info["path"].write_text(
                    json.dumps(g_info["data"], ensure_ascii=False, indent=4) + "\n",
                    encoding="utf-8"
                )
                print(f"   - {g_info['path'].name} 分配了 {assign_count} 個單字 (ID: {g_info['id']})")
        else:
            print(f"⚠️ 找不到 Part {part_num} 對應的文法檔案！")

    print("\n✅ 所有單字分配與存檔作業完成！")

if __name__ == "__main__":
    main()