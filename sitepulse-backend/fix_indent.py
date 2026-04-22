import sys

with open('main.py', 'r') as f:
    lines = f.readlines()

start_idx = -1
for i, line in enumerate(lines):
    if line.startswith('async def export_status_pdf('):
        start_idx = i
        break

try_idx = -1
for i in range(start_idx, len(lines)):
    if lines[i].strip() == 'try:':
        try_idx = i
        break

except_idx = -1
for i in range(try_idx, len(lines)):
    if lines[i].strip() == 'except fitz.FileDataError:':
        except_idx = i
        break

new_lines = lines[:try_idx + 1]
new_lines.append('        await verify_sheet_access(sheet_id, user["sub"])\n')
new_lines.append('        def process_export():\n')

streaming_idx = -1
for i in range(except_idx - 1, try_idx, -1):
    if 'return StreamingResponse(' in lines[i]:
        streaming_idx = i
        break

for i in range(try_idx + 1, streaming_idx):
    if lines[i] == '\n':
        new_lines.append(lines[i])
    else:
        new_lines.append('    ' + lines[i])

new_lines.append('            return pdf_bytes\n\n')
new_lines.append('        import asyncio\n')
new_lines.append('        pdf_bytes = await asyncio.to_thread(process_export)\n')

for i in range(streaming_idx, except_idx):
    new_lines.append(lines[i])

new_lines.extend(lines[except_idx:])

with open('main.py', 'w') as f:
    f.writelines(new_lines)
