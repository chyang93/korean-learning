import os
import json

# 設定資料夾路徑
GRAMMAR_DIR = os.path.join('data', 'grammar')
VOCAB_DIR = os.path.join('data', 'vocabulary')

def distribute_vocab():
    # 1. 建立章節地圖：part_id -> [該章節所有的課文檔案路徑]
    chapter_map = {}
    
    print("🔍 正在掃描課文檔案並分類章節 (Part)...")
    
    # 遍歷所有課文檔案
    for filename in os.listdir(GRAMMAR_DIR):
        if filename.endswith('.json'):
            file_path = os.path.join(GRAMMAR_DIR, filename)
            try:
                # 使用 utf-8-sig 處理 BOM，避免編碼報錯
                with open(file_path, 'r', encoding='utf-8-sig') as f:
                    data = json.load(f)
                    
                    # 🟢 修正：檢查 data 是否為字典格式，避免 AttributeError
                    if not isinstance(data, dict):
                        continue
                    
                    part = data.get('part')
                    if part is not None:
                        if part not in chapter_map:
                            chapter_map[part] = []
                        chapter_map[part].append(file_path)
            except Exception as e:
                print(f"❌ 讀取 {filename} 失敗: {e}")

    # 2. 依照章節進行分配
    for part, grammar_files in chapter_map.items():
        # 確保課文檔案依名稱排序，確保分配順序一致
        grammar_files.sort()
        num_lessons = len(grammar_files)
        
        # 尋找對應的單字檔 (例如 part-05.json)
        vocab_filename = f"part-{str(part).zfill(2)}.json"
        vocab_path = os.path.join(VOCAB_DIR, vocab_filename)
        
        if not os.path.exists(vocab_path):
            print(f"⚠️ 找不到章節 {part} 的單字檔: {vocab_path}，跳過。")
            continue
            
        try:
            # 讀取單字清單
            with open(vocab_path, 'r', encoding='utf-8-sig') as f:
                vocab_list = json.load(f)
                # 單字檔通常是陣列格式
                vocab_ids = [v['id'] for v in vocab_list if isinstance(v, dict) and 'id' in v]
                
            total_vocab = len(vocab_ids)
            if total_vocab == 0:
                print(f"⚠️ 章節 {part} 的單字檔為空，跳過。")
                continue

            # 🟢 核心分配邏輯：47/3 = 15 餘 2
            base_size = total_vocab // num_lessons
            remainder = total_vocab % num_lessons
            
            print(f"📦 章節 {part}: {total_vocab} 單字 ➔ {num_lessons} 課文 (分配規則: {base_size}+{1 if remainder>0 else 0})")
            
            start_idx = 0
            for i in range(num_lessons):
                # 前面幾課會多分一個單字，直到餘數分完為止
                chunk_size = base_size + (1 if i < remainder else 0)
                end_idx = start_idx + chunk_size
                current_chunk = vocab_ids[start_idx:end_idx]
                
                # 更新課文 JSON 的 relatedVocabIds
                with open(grammar_files[i], 'r', encoding='utf-8-sig') as f:
                    lesson_data = json.load(f)
                
                lesson_data['relatedVocabIds'] = current_chunk
                
                # 寫回檔案 (確保使用 utf-8 且縮排整齊)
                with open(grammar_files[i], 'w', encoding='utf-8') as f:
                    json.dump(lesson_data, f, ensure_ascii=False, indent=4)
                
                start_idx = end_idx
                # print(f"   ✅ {os.path.basename(grammar_files[i])} 已更新")
                
        except Exception as e:
            print(f"❌ 處理章節 {part} 時發生錯誤: {e}")

    print("\n🎉 分配完成！請重新執行連貫性檢查腳本進行驗證。")

if __name__ == "__main__":
    distribute_vocab()