import json
import re
import os

def batch_update(start_id, end_id, offset=3):
    directory = "data/grammar"
    
    for i in range(start_id, end_id + 1):
        filename = f"part-{i:02d}.json"
        file_path = os.path.join(directory, filename)
        
        if not os.path.exists(file_path):
            continue

        try:
            # 使用 utf-8-sig 確保相容性 [cite: 2026-03-11]
            with open(file_path, 'r', encoding='utf-8-sig') as f:
                data = json.load(f)

            changed = False
            # 處理資料格式（可能是陣列或物件） [cite: 2026-03-11]
            items = data if isinstance(data, list) else [data]

            for item in items:
                if 'title' in item:
                    original = item['title']
                    # 尋找 # 後面的數字並加 3
                    new_title = re.sub(r'#(\d+)', lambda m: f"#{int(m.group(1)) + offset}", original)
                    
                    if original != new_title:
                        item['title'] = new_title
                        changed = True
                        print(f"✅ {filename}: {original} -> {new_title}")

            if changed:
                with open(file_path, 'w', encoding='utf-8') as f:
                    json.dump(data, f, ensure_ascii=False, indent=4)
                    
        except Exception as e:
            print(f"❌ 處理 {filename} 時發生錯誤: {e}")

# 執行 04 到 118 的批次修改 [cite: 2026-03-11]
batch_update(4, 118, 3)