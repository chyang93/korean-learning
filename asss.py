import os
import json

GRAMMAR_DIR = os.path.join('data', 'grammar')
VOCAB_DIR = os.path.join('data', 'vocabulary')

def fix_vocab_continuity_v2():
    chapter_map = {}
    
    # 1. 讀取所有課文，按 'part' 分組
    for filename in os.listdir(GRAMMAR_DIR):
        if filename.endswith('.json'):
            path = os.path.join(GRAMMAR_DIR, filename)
            try:
                with open(path, 'r', encoding='utf-8-sig') as f:
                    data = json.load(f)
                    if not isinstance(data, dict): continue
                    
                    p = data.get('part')
                    # 🟢 核心修正：將 ID 轉為整數排序，防止 "100" 排在 "99" 前面
                    lid = int(data.get('id', 0))
                    
                    if p is not None:
                        if p not in chapter_map:
                            chapter_map[p] = []
                        chapter_map[p].append({'path': path, 'id': lid})
            except Exception as e:
                print(f"❌ 讀取 {filename} 失敗: {e}")

    # 2. 按章節順序處理
    for part_val, lessons in sorted(chapter_map.items()):
        # 🟢 強制按數字 ID 排序
        lessons.sort(key=lambda x: x['id'])
        
        num_lessons = len(lessons)
        vocab_filename = f"part-{str(part_val).zfill(2)}.json"
        vocab_path = os.path.join(VOCAB_DIR, vocab_filename)
        
        if not os.path.exists(vocab_path): continue
            
        try:
            with open(vocab_path, 'r', encoding='utf-8-sig') as f:
                vocab_list = json.load(f)
                v_ids = [v['id'] for v in vocab_list if isinstance(v, dict) and 'id' in v]
            
            total_v = len(v_ids)
            if total_v == 0: continue
            
            # 平均分配邏輯 (商數 + 餘數)
            base_size = total_v // num_lessons
            remainder = total_v % num_lessons
            
            print(f"📦 Part {part_val}: 分配 {total_v} 單字到 {num_lessons} 課文 (ID 排序修正)")
            
            current_idx = 0
            for i, lesson_info in enumerate(lessons):
                size = base_size + (1 if i < remainder else 0)
                chunk = v_ids[current_idx : current_idx + size]
                
                with open(lesson_info['path'], 'r', encoding='utf-8-sig') as f:
                    content = json.load(f)
                
                content['relatedVocabIds'] = chunk
                
                with open(lesson_info['path'], 'w', encoding='utf-8') as f:
                    json.dump(content, f, ensure_ascii=False, indent=4)
                
                current_idx += size
        except Exception as e:
            print(f"❌ 處理 Part {part_val} 時出錯: {e}")

    print("\n🎉 單字銜接已按數字順序修復完成！")

if __name__ == "__main__":
    fix_vocab_continuity_v2()