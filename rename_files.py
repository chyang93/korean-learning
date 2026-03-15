import json
import os

def merge_vocabulary_json():
    input_dir = 'data/vocabulary'
    output_file = 'data/vocabulary/all_vocabularies.json'
    combined_data = []

    print("🚀 開始合併 30 個單字 JSON 檔案 (處理 BOM)...")

    for i in range(1, 31):
        filename = f"part-{str(i).zfill(2)}.json"
        filepath = os.path.join(input_dir, filename)
        
        if os.path.exists(filepath):
            try:
                # 🟢 使用 utf-8-sig 解決 Unexpected UTF-8 BOM 報錯
                with open(filepath, 'r', encoding='utf-8-sig') as f:
                    data = json.load(f)
                    
                    # 確保資料格式統一為陣列合併
                    if isinstance(data, list):
                        combined_data.extend(data)
                    else:
                        combined_data.append(data)
            except Exception as e:
                print(f"❌ 讀取 {filename} 時出錯: {e}")
        else:
            print(f"⚠️ 找不到檔案: {filename}")

    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(combined_data, f, ensure_ascii=False, indent=2)

    print(f"✅ 合併完成！總計 {len(combined_data)} 個單字，存儲於 {output_file}")

if __name__ == "__main__":
    merge_vocabulary_json()