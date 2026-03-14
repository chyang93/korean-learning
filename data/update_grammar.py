import os
import json

def batch_increment_parts(start_num, end_num, part_offset):
    # 設定目標目錄
    base_dir = os.path.join('data', 'grammar')
    
    # 遍歷指定的檔案範圍 (從 24 到 115)
    for i in range(start_num, end_num + 1):
        # 根據您的系統，支援三位數補零格式 (如 part-024.json 或 part-24.json)
        # 這裡會檢查兩種可能的命名方式
        possible_filenames = [f"part-{i:03d}.json", f"part-{i:02d}.json", f"part-{i}.json"]
        
        found_file = False
        for filename in possible_filenames:
            file_path = os.path.join(base_dir, filename)
            
            if os.path.exists(file_path):
                found_file = True
                try:
                    # 1. 讀取 JSON 內容 (使用 utf-8-sig 處理 BOM)
                    with open(file_path, 'r', encoding='utf-8-sig') as f:
                        data = json.load(f)
                    
                    # 2. 更新 Part 欄位 (+1)
                    if 'part' in data:
                        old_part = data['part']
                        data['part'] = old_part + part_offset
                        
                        # 3. 寫入原檔案 (儲存為標準無 BOM 的 UTF-8)
                        with open(file_path, 'w', encoding='utf-8') as f:
                            json.dump(data, f, ensure_ascii=False, indent=4)
                        
                        print(f"✅ 成功：{filename} (Part: {old_part} -> {data['part']})")
                    else:
                        print(f"⚠️ 跳過：{filename} 中找不到 'part' 欄位")
                        
                except Exception as e:
                    print(f"❌ 錯誤：處理 {filename} 時發生問題: {e}")
                break
        
        if not found_file:
            # 只有當所有可能的格式都找不到時才提示
            pass

# 🚀 執行：將 24 到 115 的檔案內容中 part 全部 +1
batch_increment_parts(24, 115, 1)