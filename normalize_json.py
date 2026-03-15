import json
import os

# 針對 11 個發音檔進行補完
for i in range(1, 12):
    filename = f"data/grammar/pronunciation-{i:02d}.json"
    if os.path.exists(filename):
        with open(filename, 'r', encoding='utf-8') as f:
            data = json.load(f)
        
        # 補上缺失的欄位
        if isinstance(data, dict) and "introDialogue" not in data:
            data["introDialogue"] = {"A": "", "A_zh": "", "B": "", "B_zh": ""}
            
        with open(filename, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=4)
        print(f"✅ 已補完: {filename}")