import json
import os
import glob

THRESHOLD = 26

def check_all_parts(folder_path):
    # 搜尋該資料夾下所有的 json 檔案
    search_path = os.path.join(folder_path, "*.json")
    files = glob.glob(search_path)
    
    if not files:
        print(f"⚠️ 在 {folder_path} 找不到任何 JSON 檔案")
        return

    print(f"🔍 開始檢查 {folder_path} 內的長標題...")
    for file_path in files:
        with open(file_path, 'r', encoding='utf-8-sig') as f:
            try:
                data = json.load(f)
                # 判斷是單一物件還是列表
                items = data if isinstance(data, list) else [data]
                
                for item in items:
                    title = item.get('title', '')
                    if len(title) > THRESHOLD:
                        file_name = os.path.basename(file_path)
                        print(f"[{file_name}] ID: {item.get('id')} | 長度: {len(title)} | 內容: {title}")
            except Exception as e:
                print(f"讀取 {file_path} 失敗: {e}")

# 請確保路徑正確
check_all_parts('./data/grammar/')