import os
import json
import re

# 設定資料夾路徑
GRAMMAR_DIR = os.path.join('data', 'grammar')

def get_vocab_num(vocab_id):
    """擷取 V101 中的數字 101"""
    if not vocab_id: return None
    match = re.search(r'V(\d+)', str(vocab_id))
    return int(match.group(1)) if match else None

def check_vocab_continuity():
    lessons = []
    print(f"🚀 開始檢查單字連貫性... (目標：{GRAMMAR_DIR})\n")

    # 1. 讀取並初步過濾檔案
    for filename in os.listdir(GRAMMAR_DIR):
        if filename.endswith('.json'):
            path = os.path.join(GRAMMAR_DIR, filename)
            try:
                with open(path, 'r', encoding='utf-8-sig') as f:
                    data = json.load(f)
                    
                    # 🟢 修正：跳過格式錯誤的清單檔案
                    if not isinstance(data, dict):
                        continue
                        
                    lessons.append({
                        'file': filename,
                        'id': data.get('id'),
                        'vocabs': data.get('relatedVocabIds', [])
                    })
            except Exception as e:
                print(f"❌ 讀取 {filename} 失敗: {e}")

    # 2. 依照課程 ID 排序，確保檢查順序正確
    lessons.sort(key=lambda x: (x['id'] if x['id'] is not None else -1))

    last_end_v = None
    last_file = ""
    error_count = 0

    # 3. 逐一比對
    for entry in lessons:
        v_list = entry['vocabs']
        if not v_list:
            print(f"⚠️  注意: {entry['file']} (ID: {entry['id']}) 沒有分配單字。")
            continue

        first_v = get_vocab_num(v_list[0])
        last_v = get_vocab_num(v_list[-1])

        # 檢查與前一章節的銜接
        if last_end_v is not None:
            if first_v != last_end_v + 1:
                print(f"❌ 銜接錯誤！")
                print(f"   前章 ({last_file}) 結束於: V{str(last_end_v).zfill(3)}")
                print(f"   本章 ({entry['file']}) 開始於: V{str(first_v).zfill(3)}")
                print(f"   (預期應該是 V{str(last_end_v + 1).zfill(3)})")
                error_count += 1
        
        last_end_v = last_v
        last_file = entry['file']

    if error_count == 0:
        print("\n✅ 檢查完成！所有章節單字 ID 均完美連貫。")
    else:
        print(f"\n❌ 總共發現 {error_count} 處銜接錯誤。")

if __name__ == "__main__":
    check_vocab_continuity()