import os
import json

def update_json_ids(directory_path):
    # 確保資料夾存在
    if not os.path.exists(directory_path):
        print(f"❌ 找不到路徑: {directory_path}")
        return

    print(f"🔍 開始掃描資料夾: {directory_path} ...")
    
    # 遍歷資料夾中的所有檔案
    for filename in os.listdir(directory_path):
        if filename.endswith(".json"):
            file_path = os.path.join(directory_path, filename)
            
            try:
                with open(file_path, 'r', encoding='utf-8') as f:
                    data = json.load(f)

                modified = False
                
                # 處理 JSON 資料（支援 陣列 或 單一物件 格式）
                if isinstance(data, list):
                    for item in data:
                        if "id" in item:
                            current_id = item["id"]
                            # 判斷 ID 是否在 1 到 115 之間
                            if 1 <= current_id <= 115:
                                item["id"] += 3
                                modified = True
                elif isinstance(data, dict):
                    if "id" in data:
                        current_id = data["id"]
                        if 1 <= current_id <= 115:
                            data["id"] += 3
                            modified = True

                # 如果有修改，則寫回檔案
                if modified:
                    with open(file_path, 'w', encoding='utf-8') as f:
                        json.dump(data, f, ensure_ascii=False, indent=4)
                    print(f"✅ 已更新: {filename}")
                else:
                    print(f"ℹ️ 跳過: {filename} (無符合範圍之 ID)")

            except Exception as e:
                print(f"⚠️ 處理 {filename} 時發生錯誤: {e}")

    print("\n✨ 所有符合條件的 ID 已更新完成！")

if __name__ == "__main__":
    # 請確保此路徑指向您的文法 JSON 資料夾
    target_dir = "./data/grammar/"
    update_json_ids(target_dir)