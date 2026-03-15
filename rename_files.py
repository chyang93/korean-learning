import os
import json

def distribute_vocab_by_part(vocab_dir, grammar_dir):
    grammar_groups = {}
    
    if not os.path.exists(grammar_dir):
        print(f"❌ 找不到文法資料夾: {grammar_dir}")
        return

    print("🔍 正在掃描文法章節並進行分組...")
    for filename in os.listdir(grammar_dir):
        if filename.endswith(".json"):
            path = os.path.join(grammar_dir, filename)
            try:
                # 🟢 修正 1: 使用 utf-8-sig 讀取文法檔
                with open(path, 'r', encoding='utf-8-sig') as f:
                    data = json.load(f)
                
                items = data if isinstance(data, list) else [data]
                for item in items:
                    p = item.get("part")
                    if p is not None:
                        if p not in grammar_groups:
                            grammar_groups[p] = []
                        grammar_groups[p].append({
                            "file": path,
                            "id": item.get("id")
                        })
            except Exception as e:
                print(f"⚠️ 讀取文法檔 {filename} 出錯: {e}")

    for part_num, chapters in grammar_groups.items():
        chapters.sort(key=lambda x: x["id"])
        
        vocab_filename = f"part-{part_num:02d}.json"
        vocab_path = os.path.join(vocab_dir, vocab_filename)
        
        if not os.path.exists(vocab_path):
            print(f"ℹ️ 跳過 Part {part_num}: 找不到單字檔 {vocab_filename}")
            continue

        try:
            # 🟢 修正 2: 使用 utf-8-sig 讀取單字檔
            with open(vocab_path, 'r', encoding='utf-8-sig') as f:
                vocab_list = json.load(f)
            
            vocab_ids = [v["id"] for v in vocab_list]
            num_words = len(vocab_ids)
            num_chapters = len(chapters)
            
            base_size = num_words // num_chapters
            remainder = num_words % num_chapters
            
            print(f"📦 Part {part_num}: 分配 {num_words} 個單字到 {num_chapters} 課...")
            
            current_idx = 0
            for i, chap_info in enumerate(chapters):
                size = base_size + (1 if i < remainder else 0)
                assigned_ids = vocab_ids[current_idx : current_idx + size]
                current_idx += size
                
                # 🟢 修正 3: 讀取與寫入文法檔
                with open(chap_info["file"], 'r', encoding='utf-8-sig') as f:
                    chap_content = json.load(f)
                
                if isinstance(chap_content, list):
                    for item in chap_content:
                        if item.get("id") == chap_info["id"]:
                            item["relatedVocabIds"] = assigned_ids
                else:
                    chap_content["relatedVocabIds"] = assigned_ids
                
                # 寫回時建議使用標準 utf-8 即可
                with open(chap_info["file"], 'w', encoding='utf-8') as f:
                    json.dump(chap_content, f, ensure_ascii=False, indent=4)
            
            print(f"   ✅ Part {part_num} 分配完成")

        except Exception as e:
            print(f"❌ 處理 Part {part_num} 單字時出錯: {e}")

    print("\n✨ 所有單字已重新按 Part 分配完畢！")

if __name__ == "__main__":
    VOCAB_DIR = "./data/vocabulary/"
    GRAMMAR_DIR = "./data/grammar/"
    distribute_vocab_by_part(VOCAB_DIR, GRAMMAR_DIR)