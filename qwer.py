import os
import json

# 設定路徑
GRAMMAR_DIR = os.path.join('data', 'grammar')
OUTPUT_FILE = os.path.join(GRAMMAR_DIR, 'all_chapters.json')

def merge_grammar_json():
    all_chapters = []
    
    print(f"🚀 開始整合課文檔案至: {OUTPUT_FILE}")
    
    # 1. 取得資料夾內所有 JSON 檔案
    files = [f for f in os.listdir(GRAMMAR_DIR) if f.endswith('.json') and f != 'all_chapters.json']
    
    for filename in files:
        file_path = os.path.join(GRAMMAR_DIR, filename)
        try:
            # 🟢 修正：使用 utf-8-sig 處理 BOM 標頭
            with open(file_path, 'r', encoding='utf-8-sig') as f:
                data = json.load(f)
                
                # 🟢 修正：確保內容是物件 {} 而非清單 []，避免 AttributeError
                if isinstance(data, dict):
                    all_chapters.append(data)
                else:
                    print(f"⚠️ 跳過格式不符檔案: {filename} (預期為物件)")
                    
        except Exception as e:
            print(f"❌ 讀取 {filename} 失敗: {e}")

    # 2. 依照 ID 進行數字排序，確保 PWA 內的學習順序正確
    # 使用 int() 確保 100 會排在 99 後面而非 10 前面
    all_chapters.sort(key=lambda x: int(x.get('id', 0)))

    # 3. 寫入整合檔案
    try:
        # 使用標準 utf-8 寫入，確保 PWA 環境相容性
        with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
            json.dump(all_chapters, f, ensure_ascii=False, indent=4)
        
        print(f"✅ 成功整合 {len(all_chapters)} 個章節！")
        print(f"📂 輸出路徑: {OUTPUT_FILE}")
        
    except Exception as e:
        print(f"🔥 寫入失敗: {e}")

if __name__ == "__main__":
    merge_grammar_json()