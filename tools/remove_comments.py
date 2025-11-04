"""
Safe comment removal script for browser-automation workspace.
Creates .bak backups before modifying files.
"""
import os
import re
import shutil
from pathlib import Path

WORKSPACE_ROOT = Path(__file__).parent.parent
BACKUP_SUFFIX = '.bak'

def remove_python_comments(content):
    lines = content.split('\n')
    result = []
    in_docstring = False
    docstring_char = None
    
    for line in lines:
        stripped = line.lstrip()
        
        if '"""' in stripped or "'''" in stripped:
            if not in_docstring:
                quote = '"""' if '"""' in stripped else "'''"
                if stripped.count(quote) == 2:
                    continue
                else:
                    in_docstring = True
                    docstring_char = quote
                    continue
            else:
                if docstring_char in stripped:
                    in_docstring = False
                    docstring_char = None
                    continue
        
        if in_docstring:
            continue
        
        if stripped.startswith('#'):
            continue
        
        if '#' in line:
            quote_count_single = 0
            quote_count_double = 0
            for i, char in enumerate(line):
                if char == "'" and (i == 0 or line[i-1] != '\\'):
                    quote_count_single += 1
                elif char == '"' and (i == 0 or line[i-1] != '\\'):
                    quote_count_double += 1
                elif char == '#':
                    if quote_count_single % 2 == 0 and quote_count_double % 2 == 0:
                        line = line[:i].rstrip()
                        break
        
        result.append(line)
    
    return '\n'.join(result)

def remove_js_comments(content):
    result = []
    lines = content.split('\n')
    in_block_comment = False
    
    for line in lines:
        if in_block_comment:
            if '*/' in line:
                line = line[line.index('*/') + 2:]
                in_block_comment = False
            else:
                continue
        
        if '/*' in line:
            if '*/' in line:
                start = line.index('/*')
                end = line.index('*/') + 2
                line = line[:start] + line[end:]
            else:
                line = line[:line.index('/*')]
                in_block_comment = True
        
        if '//' in line:
            in_string_single = False
            in_string_double = False
            for i, char in enumerate(line):
                if char == "'" and (i == 0 or line[i-1] != '\\'):
                    in_string_single = not in_string_single
                elif char == '"' and (i == 0 or line[i-1] != '\\'):
                    in_string_double = not in_string_double
                elif char == '/' and i + 1 < len(line) and line[i+1] == '/':
                    if not in_string_single and not in_string_double:
                        line = line[:i].rstrip()
                        break
        
        result.append(line)
    
    return '\n'.join(result)

def remove_html_comments(content):
    return re.sub(r'<!--.*?-->', '', content, flags=re.DOTALL)

def remove_css_comments(content):
    return re.sub(r'/\*.*?\*/', '', content, flags=re.DOTALL)

def process_file(file_path):
    ext = file_path.suffix.lower()
    
    with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
        original = f.read()
    
    if ext == '.py':
        cleaned = remove_python_comments(original)
    elif ext in ['.js', '.jsx', '.ts', '.tsx']:
        cleaned = remove_js_comments(original)
    elif ext in ['.html', '.htm']:
        cleaned = remove_html_comments(original)
    elif ext == '.css':
        cleaned = remove_css_comments(original)
    elif ext == '.json':
        return None
    else:
        return None
    
    if cleaned == original:
        return None
    
    backup_path = file_path.with_suffix(file_path.suffix + BACKUP_SUFFIX)
    shutil.copy2(file_path, backup_path)
    
    with open(file_path, 'w', encoding='utf-8', newline='') as f:
        f.write(cleaned)
    
    lines_before = len(original.split('\n'))
    lines_after = len(cleaned.split('\n'))
    
    return {
        'backup': backup_path,
        'lines_removed': lines_before - lines_after,
        'size_before': len(original),
        'size_after': len(cleaned)
    }

def main():
    extensions = ['.py', '.js', '.jsx', '.ts', '.tsx', '.html', '.htm', '.css']
    files_to_process = []
    
    for ext in extensions:
        files_to_process.extend(WORKSPACE_ROOT.rglob(f'*{ext}'))
    
    files_to_process = [f for f in files_to_process if '__pycache__' not in str(f) and 'node_modules' not in str(f)]
    
    print(f"Found {len(files_to_process)} files to process:")
    for f in files_to_process:
        print(f"  - {f.relative_to(WORKSPACE_ROOT)}")
    
    print("\nProcessing files...")
    
    modified_count = 0
    total_lines_removed = 0
    
    for file_path in files_to_process:
        result = process_file(file_path)
        if result:
            modified_count += 1
            total_lines_removed += result['lines_removed']
            rel_path = file_path.relative_to(WORKSPACE_ROOT)
            print(f"✓ {rel_path}: {result['lines_removed']} lines removed, {result['size_before']-result['size_after']} bytes saved")
    
    print(f"\n{'='*60}")
    print(f"Summary:")
    print(f"  Files scanned: {len(files_to_process)}")
    print(f"  Files modified: {modified_count}")
    print(f"  Total lines removed: {total_lines_removed}")
    print(f"  Backups created in same directories with {BACKUP_SUFFIX} extension")
    print(f"{'='*60}")

if __name__ == '__main__':
    main()
